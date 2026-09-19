const mysql = require("mysql2/promise");
const http = require("http");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const ID_LENGTH = 6;
const PORT = 8000;
const SALT_ROUNDS = 10;

let connection;

async function connectDB() {
  const connection = await mysql.createConnection({
    host: "localhost",
    user: "root",
    password: process.env.DB_PASSWORD,
    database: "link_shortener",
  });

  console.log("Connected to link_shortener");

  return connection;
}

function generateId(length) {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";

  for (let i = 0; i < length; i++) {
    id += chars[crypto.randomInt(0, chars.length)];
  }

  return id;
}

async function insertLink(url, customId, userId) {
  // console.log("Inserting link:", url, customId);
  if (!customId) {
    // console.log("Only URL is provided");
    let repeat = 0;
    let genId = "";
    while (repeat++ < 10) {
      genId = generateId(ID_LENGTH);
      const [rows] = await connection.query(
      `SELECT id FROM links WHERE id = ?`,
      [genId]);
      if (rows.length === 0) {
        customId = genId;
        break;
      }
    } 
    if (!customId) return 409;
  }
  try {
    const results = await connection.query(
      `INSERT INTO links (id, url, user_id)
      VALUES (?, ?, ?)`,
      [customId, url, userId],
    );
    // console.log("results:", results);
    return 201;
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      console.error("Duplicate entry for custom ID:", customId);
      return 409;
    } else {
      console.error("Error inserting link:", err);
      return 500;
    }
  }
}

async function deleteLink(id, userId) {
  try {
    const results = await connection.query(`DELETE FROM links WHERE id = ? AND user_id = ?`, [
      id, userId
    ]);
    console.log(results);
    return results[0].affectedRows > 0 ? 204 : 404;
  } catch (err) {
    console.error("Error deleting link:", err);
    if (err.name === "JsonWebTokenError") {
      console.log("Unauthorized.");
      return 401;
    }
    return 500;
  }
}

async function registerUser(username, password) {
  console.log("username:", username);
  console.log("password:", password);
  if (username.length <= 0 || password.length <= 0) {
    return 400;
  }
  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    console.log("Hashed pass:", passwordHash);
    const results = await connection.query(`
      INSERT INTO users (username, password_hash)
      VALUES (?, ?)`,
      [username, passwordHash]
    );
    console.log("results:", results);
    return 201;
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      console.error("Username already exists.");
      return 409;
    } else {
      console.error("Unexpected error registering:", err);
      return 500;
    }
  }
}

async function loginUser(username, password) {
  if (username.length <= 0 || password.length <= 0) {
    return { "status": 400, "token": null };
  }
  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    console.log("Hashed pass:", passwordHash);
    const [results] = await connection.query(`
      SELECT id, username, password_hash FROM users u
      WHERE u.username = ?`, 
      [username]
    );
    if (results.length <= 0) {
      console.error("Username not found. Try registering.")
      return {"status": 401, "token": null };
    }
    const user = results[0]
    const passwordCorrect = await bcrypt.compare(password, user.password_hash);
    if (!passwordCorrect) {
      console.error("Wrong password.")
      return { "status": 401, "token": null };
    }
    console.log("login results:", results);

    const token = jwt.sign({userId: user.id}, process.env.JWT_SECRET, {expiresIn: "1h"});

    console.log("token:", token);

    return { "status": 200, "token": token };
  } catch (err) {
      console.error("Unexpected error registering:", err);
      return { "status": 401, "token": null };
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

  const decode = jwt.verify(token, process.env.JWT_SECRET);
  console.log("decode:", decode);
  return decode;
}

async function startServer() {
  connection = await connectDB();

  const server = http.createServer(async (req, res) => {
    console.log(req.url);
    try {
      if (req.url.startsWith("/api/links")) {
        console.log("Entered /api/links");
        if (req.method === "DELETE") { //ADD AUTH
          const user = authenticateUser(req);
          if (!user) {
            res.writeHead(401, { "Content-Type": "text/plain" });
            res.end();
            return null;
          }

          const userId = user.userId;
          const id = req.url.replace("/api/links/", "");
          // console.log("id:", id);
          // console.log("req.url:", req.url);
          const statusCode = await deleteLink(id, userId);
          res.writeHead(statusCode, { "Content-Type": "text/plain" });
          res.end();
          return;
        }

        if (req.method === "GET") { // ADD AUTH
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Get Method.");
          return;
        }

        if (req.method === "POST") { // ADD AUTH
          const decode = authenticateUser(req);
          if (!decode) {
            res.writeHead(401, { "Content-Type": "text/plain" })
            res.end("User not found");
            return;
          }
          console.log(typeof decode, decode);

          const userId = decode.userId;
          console.log("User Id: ", userId);
          let body = "";

          req.on("data", (chunk) => {
            body += chunk;
          });

          req.on("end", async () => {
            const data = JSON.parse(body);
            const statusCode = await insertLink(data.url, data.customId, userId);
            res.writeHead(statusCode, { "Content-Type": "text/plain" });
            res.end();
          });

          return;
        }
      } else if (req.url.startsWith("/api/auth")) {
        let body = "";
        req.on("data", chunk => {
          body += chunk;
        });

        if (req.method === "POST" && req.url === "/api/auth/register") {
          req.on("end", async () => {
            const data = JSON.parse(body);
            const statusCode = await registerUser(data.username, data.password);
            res.writeHead(statusCode, { "Content-Type": "text/plain"});
            res.end();
          });
        }
        if (req.method === "POST" && req.url === "/api/auth/login") {
          console.log("Entered auth login.");
          req.on("end", async () => {
            const data = JSON.parse(body);
            const response = await loginUser(data.username, data.password);
            res.writeHead(response.status, { "Content-Type": "application/json"});
            if (response.token) {
              res.end(JSON.stringify({
                message: "Login successful.",
                token: response.token
              }));
            } else {
              res.end(JSON.stringify({
                message: "Invalid username or password."
              }));
            }
          });
        }
        if (req.method === "POST" && req.url === "/api/auth/logout") {}

      } else if (req.method === "GET") {
        const code = req.url.substring(1);

        const [results] = await connection.query(
          "SELECT url FROM links WHERE id = ?",
          [code],
        );

        if (!results.length) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Link not found");
          return;
        }

        res.writeHead(302, {
          Location: results[0].url,
        });
        res.end();
        return;
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not found!");
      }
    } catch (err) {
      console.error(err);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Internal Server Error");
    }
  });

  server.listen(PORT, () => {
    console.log("Server is running on port " + PORT);
  });
}

startServer();
