import http from "http";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import qr from "qrcode";
import "dotenv/config";

import { User, Link, ClickEvent} from "./Database/relations.mjs"
import { initDB } from "./Database/index.mjs";

const ID_LENGTH = 6;
const PORT = 8000;
const SALT_ROUNDS = 10;

async function incrementClicks(linkId) {
  await Link.increment("clickCount", {
    by: 1,
    where: {
      id: linkId
    }
  });
}

function generateId(length) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";

  for (let i = 0; i < length; i++) {
    id += chars[Math.floor(Math.random() * 62)];
  }

  return id;
}

function responseHelper(res, statusCode, header, content="", notString=false) {
  res.writeHead(statusCode, header);
  res.end(notString ? content : JSON.stringify(content));
  return;
}

function extractBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      resolve(body);
    });

    req.on("error", error => {
      reject(error);
    });
  });
}

async function insertLink(url, alias, userId, expiry) {
  if (!url) {
    return {status: 400, message: "URL not provided"}
  }
  if (!alias) {
    let repeat = 0;
    let genId = "";
    while (repeat++ < 10) {
      genId = generateId(ID_LENGTH);
      const isDup = await Link.findOne({
        where: {alias: genId}
      });
      if (!isDup) {
        alias = genId;
        break;
      }
    } 
    const isDup = await Link.findOne({
      where: { alias }
    });
    if (isDup) {
      return {status: 409, message: "This alias already exists"};
    }
  }
  const isDup = await Link.findOne({
    where: {alias}
  });
  if (isDup) {
    return {status: 409, message: "This alias already exists"};
  }
  try {
    if (!expiry) {
      await Link.create({
        alias,
        url,
        userId
      });
    } else {
      const expiresAt = new Date(Date.now() + expiry*1000);
      await Link.create({
        alias,
        url,
        userId,
        expiresAt
      })
    }
    return {status: 201, message: "Short link created"};
  } catch (err) {
    return {status: 500, message: "Server is unable to complete your request."};
  }
}

async function deleteLink(alias, userId) {
  if (!alias) {
    return { status: 400, message: "No short link provided." };
  }
  try {
    const link = await Link.findOne({
      where: {alias}
    });
    if (!link || !link.userId) {
      return { status: 404, message: "No short links found for this user." };
    }
    if (userId !== link.userId) {
      return { status: 403, message: "This user is not allowed to delete or modify this link." };
    }
    const deleted = await Link.destroy({
      where: {alias}
    });
    return deleted > 0 ?
      { status: 204 } : 
      { status: 404, message: "No short links found for this user." };
  } catch (err) {
    if (err.name === "JsonWebTokenError") {
      return {status: 401, message: "Invalid authentication." };
    }
    return { status: 500, message: "Server unable to complete your request." };
  }
}

async function retrieveLinks(userId) {
  try {
    const links = await Link.findAll({
      attributes:[
        "alias",
        "url",
        "created_at",
        "expires_at"
      ],
      where: {userId}
    });
    return { status: 200, message: links };
  } catch (err) {
    return { status: 500, message: "Server unable to complete your request." };
  }
}

async function registerUser(username, password) {
  if (!username || !password) {
    return {status: 400, message: "Username or password not provided."};
  }
  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const isDup = await User.findOne({
      where: {username}
    });
    if (isDup) {
      return {status: 409, message: "This username is taken"};
    }
    await User.create({
      username,
      passwordHash
    })
    return {status: 201, message: "User registered"};
  } catch (err) {
    console.error(err);
    if (err.code === "ER_DUP_ENTRY") {
      return {status: 409, message: "This username is taken"};
    } else {
      return {status: 500, message: "Server is unable to complete your request."};
    }
  }
}

async function loginUser(username, password) {
  if (username.length <= 0 || password.length <= 0) {
    return { status: 400, token: null, message: "Username or password not provided" };
  }
  try {
    const user = await User.findOne({
      where: {username}
    });
    if (!user) {
      return {status: 401, token: null, message: "Incorrect username"};
    }
    const passwordCorrect = await bcrypt.compare(password, user.passwordHash);
    if (!passwordCorrect) {
      return { status: 401, token: null, message: "Incorrect password" };
    }

    const token = jwt.sign({userId: user.id}, process.env.JWT_SECRET, {expiresIn: "1h"});

    return { status: 200, token: token, message: "Logged in successfully" };
  } catch (err) {
      console.error(err);
      return { status: 401, token: null, message: "Login failed" };
  }
}

function authenticateUser(req) {
  const header = req.headers.authorization;

  if (!header) {
    return null;
  }

  const [type, token] = header.split(" ");

  if (type !== "Bearer" || !token) {
    return null;
  }

  try {
    const decode = jwt.verify(token, process.env.JWT_SECRET);
    return decode;
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return null;
    }
  }
}

async function startServer() {
  await initDB();

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/api/links")) {
        const url = req.url.replace("/api/links", "");

        if (req.method === "GET" && url.endsWith("/qr")) {
          const alias = url.slice(1, -"/qr".length);
          const link = await Link.findOne({
            attributes: [
              "url",
              "expires_at"
            ],
            where: {alias}
          });
        
          if (!link) {
            responseHelper(res, 404, { "Content-Type": "application/json" }, { "error": "Link not found" });
            return;
          }
          if (link.expiresAt !== null && link.expiresAt <= new Date()) {
            responseHelper(res, 410, { "Content-Type": "application/json" }, { "error": "Link has expired" });
            return;
          }
          
          const qrBuffer = await qr.toBuffer(`http://${process.env.DB_HOST}:${PORT}/${alias}`, 
            {
              type: "png",
              width: 300,
              margin: 1
            }
          );

          responseHelper(res, 200, { "Content-Type": "image/png", "Content-Length": qrBuffer.length }, qrBuffer, true);
          return;
        }

        const user = authenticateUser(req);
        if (!user) {
          responseHelper(res, 401, { "Content-Type": "application/json" }, { "error": "Unauthorized." });
          return;
        }
        const userId = user.userId;
        if (req.method === "DELETE") {
          if (url[0] !== "/") {
            responseHelper(res, 400, { "Content-Type": "application/json" }, { "error": "No short link provided." });
            return; 
          }
          const alias = url.slice(1);
          const response = await deleteLink(alias, userId);
          responseHelper(res, response.status, { "Content-Type": "application/json" }, response.message);
          return;
        }

        if (req.method === "GET") {
          const response = await retrieveLinks(userId);
          responseHelper(res, response.status, { "Content-Type": "application/json" }, response.message);
          return;
        }

        if (req.method === "POST") {
          const body = await extractBody(req);

          const data = JSON.parse(body);
          const response = await insertLink(data.url, data.alias, userId, data.expiry);
          responseHelper(res, response.status, { "Content-Type": "text/plain" }, response.message);          
          return;
        }
      } else if (req.url.startsWith("/api/auth")) {
        const body = await extractBody(req);
        const data = JSON.parse(body);

        if (req.method === "POST" && req.url === "/api/auth/register") {          
          const response = await registerUser(data.username, data.password);
          responseHelper(res, response.status, { "Content-Type": "text/plain" }, response.message);
        }
        if (req.method === "POST" && req.url === "/api/auth/login") {
          const response = await loginUser(data.username, data.password);
          if (response.token) {
            responseHelper(res, response.status, { "Content-Type": "application/json" }, {
              message: response.message,
              token: response.token
            });
          } else {
            responseHelper(res, response.status, { "Content-Type": "application/json" }, response.message);
          }
        }
        if (req.method === "POST" && req.url === "/api/auth/logout") {}

      } else if (req.method === "GET") {
        const alias = req.url.substring(1);

        const link = await Link.findOne({
          attributes: [
            "id", 
            "url", 
            "expires_at"
          ],
          where: {alias}
        });
        
        if (!link) {
          responseHelper(res, 404, { "Content-Type": "text/plain" }, "Invalid link");
          return;
        }

        const expiresAt = link.expireAat;
        if (expiresAt && expiresAt <= new Date()) {
          responseHelper(res, 404, { "Content-Type": "text/plain" }, "This short link has expired");
          return;
        }

        ClickEvent.create({
          linkId: link.id,
          ipAddress: req.socket.remoteAddress,
          userAgent: req.headers["user-agent"],
          referrer: req.headers.referer
        })

        incrementClicks(link.id);

        responseHelper(res, 302, { Location: link.url }, "Redirecting...")
        return;
      } else {
        responseHelper(res, 404, { "Content-Type": "text/plain"}, "Invalid link")
      }
    } catch (err) {
      console.error(err);
      responseHelper(res, 500, { "Content-Type": "text/plain" }, "Internal Server Error");
    }
  });

  server.listen(PORT, () => {
  });
}

startServer();
