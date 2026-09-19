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
  if (!customId) {
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
  if (!id) {
    return 400;
  }
  try {
    const results = await connection.query(`DELETE FROM links WHERE id = ? AND user_id = ?`, [
      id, userId
    ]);
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

async function retrieveLinks(userId) {
  try {
    const [rows] = await connection.query(`SELECT url FROM LINKS WHERE user_id = ?`,
      [userId]
    );
    return { statusCode: 200, links: rows };
  } catch (err) {
    console.error("Error retrieving user's created shortlinks.");
    return { statusCode: 500 };
  }
}

async function registerUser(username, password) {
  if (username.length <= 0 || password.length <= 0) {
    return 400;
  }
  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const results = await connection.query(`
      INSERT INTO users (username, password_hash)
      VALUES (?, ?)`,
      [username, passwordHash]
    );
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

    const token = jwt.sign({userId: user.id}, process.env.JWT_SECRET, {expiresIn: "1h"});

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

  try {
    const decode = jwt.verify(token, process.env.JWT_SECRET);
    return decode;
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      console.error("JWT expired.");
      return null;
    }
  }
}

async function startServer() {
  connection = await connectDB();

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/api/links")) {
        const user = authenticateUser(req);
        if (!user) {
          res.writeHead(401, { "Content-Type": "text/plain" });
          res.end();
          return;
        }
        const userId = user.userId;

        if (req.method === "DELETE") {
          if (!req.url.startsWith("/api/links/")) {
            return 400;
          }
          const id = req.url.replace("/api/links/", "");
          const statusCode = await deleteLink(id, userId);
          res.writeHead(statusCode, { "Content-Type": "text/plain" });
          res.end();
          return;
        }

        if (req.method === "GET") {
          const results = await retrieveLinks(userId);
          res.writeHead(results.statusCode, { "Content-Type": "application/json"});
          res.end(JSON.stringify(results.links));
          return;
        }

        if (req.method === "POST") {
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
          "SELECT id, url, created_at FROM links WHERE id = ?",
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
