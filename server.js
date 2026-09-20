const mysql = require("mysql2/promise");
const http = require("http");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const qr = require("qrcode");

const ID_LENGTH = 6;
const PORT = 8000;
const SALT_ROUNDS = 10;

let connection;

require("dotenv").config();

async function migrate() {
  console.log("connecting to mysql");
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS link_shortener`);
    await connection.query(`USE link_shortener`);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        username VARCHAR(25) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,

        PRIMARY KEY (id),
        UNIQUE KEY (username)
      )`);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS links (
        id INT UNSIGNED AUTO_INCREMENT,
        alias VARCHAR(20) NOT NULL UNIQUE,
        url TEXT NOT NULL,
        user_id INT UNSIGNED DEFAULT NULL,
        click_count INT UNSIGNED DEFAULT 0,
        created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL 1 HOUR),

        PRIMARY KEY (id),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )`);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS click_events (
      id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
      link_id INT UNSIGNED NOT NULL,
      ip_address VARCHAR(45) DEFAULT NULL,
      user_agent TEXT DEFAULT NULL,
      referrer TEXT DEFAULT NULL,
      created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (link_id)
          REFERENCES links(id)
          ON DELETE CASCADE
      )`);
    console.log("Database migration completed.");
    return connection;
  } catch(err) {
    console.error(err);
  }
}

async function incrementClicks(alias) {
  await connection.query(`
    UPDATE links
    SET click_count = click_count + 1
    WHERE alias = ?`,
  [alias]);
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

function responseHelper(res, statusCode, header, content="") {
  res.writeHead(statusCode, header);
  res.end(content);
  return;
}

async function insertLink(url, customAlias, userId, expiry=undefined) {
  if (!customAlias) {
    let repeat = 0;
    let genId = "";
    while (repeat++ < 10) {
      genId = generateId(ID_LENGTH);
      const [rows] = await connection.query(
      `SELECT alias FROM links WHERE alias = ?`,
      [genId]);
      if (rows.length === 0) {
        customAlias = genId;
        break;
      }
    } 
    const [results] = await connection.query(
      `SELECT alias FROM links WHERE alias = ?`,
      [customAlias]);
    if (results.length > 0) {
      return 409;
    }
  }
  try {
    if (expiry === undefined) {
      await connection.query(
        `INSERT INTO links (alias, url, user_id)
        VALUES (?, ?, ?)`,
        [customAlias, url, userId],
      );
    } else if (expiry === null) {
      await connection.query(
        `INSERT INTO links (alias, url, user_id, expires_at)
        VALUES (?, ?, ?, ?)`,
        [customAlias, url, userId, null],
      );
    } else {
      await connection.query(
        `INSERT INTO links (alias, url, user_id, expires_at)
        VALUES (?, ?, ?, ?)`,
        [customAlias, url, userId, new Date(Date.now() + expiry*1000)],
      );
    }
    
    return 201;
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return 409;
    } else {
      return 500;
    }
  }
}

async function deleteLink(alias, userId) {
  if (!alias) {
    return 400;
  }
  try {
    const [results]  = await connection.query(`SELECT alias, user_id FROM links WHERE alias = ?`, 
      [alias]);
    
    if (results.length <=0 || !results[0].user_id) {
      return 404;
    }
    if (userId !== results[0].user_id) {
      return 403;
    }
    const [deleteResults] = await connection.query(`DELETE FROM links WHERE alias = ?`, [alias]);
    return deleteResults.affectedRows > 0 ? 204 : 404;
  } catch (err) {
    if (err.name === "JsonWebTokenError") {
      return 401;
    }
    return 500;
  }
}

async function retrieveLinks(userId) {
  try {
    const [rows] = await connection.query(`SELECT alias, url, created_at FROM LINKS WHERE user_id = ?`,
      [userId]
    );
    return { statusCode: 200, links: rows };
  } catch (err) {
    return { statusCode: 500 };
  }
}

async function registerUser(username, password) {
  if (!username || !password) {
    return 400;
  }
  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const [dupCheck] = await connection.query(`SELECT id FROM users WHERE username = ?`,
      [username]
    );
    if (dupCheck.length > 0) {
      return 409;
    }
    const results = await connection.query(`
      INSERT INTO users (username, password_hash)
      VALUES (?, ?)`,
      [username, passwordHash]
    );
    return 201;
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return 409;
    } else {
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
      return {"status": 401, "token": null };
    }
    const user = results[0]
    const passwordCorrect = await bcrypt.compare(password, user.password_hash);
    if (!passwordCorrect) {
      return { "status": 401, "token": null };
    }

    const token = jwt.sign({userId: user.id}, process.env.JWT_SECRET, {expiresIn: "1h"});

    return { "status": 200, "token": token };
  } catch (err) {
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
      return null;
    }
  }
}

async function startServer() {
  connection = await migrate();

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/api/links")) {
        const url = req.url.replace("/api/links", "");

        if (req.method === "GET" && url.endsWith("/qr")) {
          const alias = url.slice(1, -"/qr".length);
          const [results] = await connection.query(`
            SELECT url, expires_at FROM links WHERE alias = ?`,
          [alias]);

          if (results.length === 0) {
            responseHelper(res, 404, { "Content-Type": "application/json" }, JSON.stringify({ "error": "Link not found" }));
            return;
          }
          if (results[0].expires_at !== null && results[0].expires_at <= new Date()) {
            responseHelper(res, 410, { "Content-Type": "application/json" }, JSON.stringify({ "error": "Link has expired" }));
            return;
          }
          
          const qrBuffer = await qr.toBuffer(`http://${process.env.DB_HOST}:${PORT}/${alias}`, 
            {
              type: "png",
              width: 300,
              margin: 1
            }
          );

          responseHelper(res, 200, { "Content-Type": "image/png", "Content-Length": qrBuffer.length }, qrBuffer);
          return;
        }

        const user = authenticateUser(req);
        if (!user) {
          responseHelper(res, 401, { "Content-Type": "text/plain" });
          return;
        }
        const userId = user.userId;

        if (req.method === "DELETE") {
          if (!req.url.startsWith("/api/links/")) {
            return responseHelper(res, 400, { "Content-Type": "text/plain" });
          }
          const alias = req.url.replace("/api/links/", "");
          const statusCode = await deleteLink(alias, userId);
          responseHelper(res, statusCode, { "Content-Type": "text/plain" });
          return;
        }

        if (req.method === "GET") {
          const results = await retrieveLinks(userId);
          responseHelper(res, results.statusCode, { "Content-Type": "text/plain" }, JSON.stringify(results.links));
          return;
        }

        if (req.method === "POST") {
          let body = "";

          req.on("data", (chunk) => {
            body += chunk;
          });

          req.on("end", async () => {
            const data = JSON.parse(body);
            const statusCode = await insertLink(data.url, data.customAlias, userId, data.expiry);
            responseHelper(res, statusCode, { "Content-Type": "text/plain" })
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
            responseHelper(res, statusCode, { "Content-Type": "text/plain" });
          });
        }
        if (req.method === "POST" && req.url === "/api/auth/login") {
          req.on("end", async () => {
            const data = JSON.parse(body);
            const response = await loginUser(data.username, data.password);
            if (response.token) {
              responseHelper(res, response.status, { "Content-Type": "application/json" }, JSON.stringify({
                message: "Login successful.",
                token: response.token
              }));
            } else {
              responseHelper(res, response.status, { "Content-Type": "application/json" }, 
                JSON.stringify({ message: "Invalid username or password" }));
            }
          });
        }
        if (req.method === "POST" && req.url === "/api/auth/logout") {}

      } else if (req.method === "GET") {
        const alias = req.url.substring(1);

        const [results] = await connection.query(
          "SELECT id, url, expires_at FROM links WHERE alias = ?",
          [alias],
        );

        if (!results.length) {
          responseHelper(res, 404, { "Content-Type": "text/plain" }, "Link not found");
          return;
        }

        const expiresAt = results[0].expires_at;
        if (expiresAt && expiresAt <= new Date()) {
          responseHelper(res, 404, { "Content-Type": "text/plain" }, "This short link has expired");
          return;
        }

        await connection.query(`
          INSERT INTO click_events (link_id, ip_address, user_agent, referrer)
          VALUES (?, ?, ?, ?)`,[
            results[0].id, 
            req.socket.remoteAddress, 
            req.headers["user-agent"], 
            req.headers.referer
          ]);

        incrementClicks(alias);

        responseHelper(res, 302, { Location: results[0].url })
        return;
      } else {
        responseHelper(res, 404, { "Content-Type": "text/plain"})
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
