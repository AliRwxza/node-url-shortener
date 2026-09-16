const mysql = require("mysql2/promise");
const http = require("http");
const crypto = require("crypto");
const bcrypt = require("bcrypt");

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

async function insertLink(url, customId) {
  // console.log("Inserting link:", url, customId);
  if (customId) {
    // console.log("Custom ID provided:", customId);
    try {
      const results = await connection.query(
        `INSERT INTO links (id, url)
        VALUES (?, ?)`,
        [customId, url],
      );
      // console.log("results:", results);
    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        console.error("Duplicate entry for custom ID:", customId);
        return 409;
      } else {
        console.error("Error inserting link:", err);
        return 500;
      }
    }
    return 201;
  } else {
    // console.log("Only URL is provided");
    let repeat = 0;
    while (repeat++ < 10) {
      const id = generateId(ID_LENGTH);
      // console.log("Generated ID:", id);
      try {
        const results = await connection.query(
          `INSERT INTO links (id, url)
            VALUES (?, ?)`,
          [id, url],
        );
        // console.log("results:", results);
        return 201;
      } catch (err) {
        if (err.code === "ER_DUP_ENTRY") {
          console.error("Duplicate entry for generated ID:", id);
        } else {
          console.error("Unexpected error inserting link:", err);
          return 500; // Faced an unexpected error while inserting the link
        }
      }
    }
    return 409; // Return 409 if unable to generate a unique ID after 10 attempts
  }
}

async function deleteLink(id) {
  try {
    const results = await connection.query(`DELETE FROM links WHERE id = ?`, [
      id,
    ]);
    return results[0].affectedRows > 0 ? 204 : 404;
  } catch (err) {
    console.error("Error deleting link:", err);
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

async function startServer() {
  connection = await connectDB();

  const server = http.createServer(async (req, res) => {
    console.log(req.url);
    try {
      if (req.url.startsWith("/api/links")) {
        console.log("Entered /api/links");
        if (req.method === "DELETE") {
          const id = req.url.replace("/api/links/", "");
          // console.log("id:", id);
          // console.log("req.url:", req.url);
          const statusCode = await deleteLink(id);
          res.writeHead(statusCode, { "Content-Type": "text/plain" });
          res.end();
          return;
        }

        if (req.method === "GET") {
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Get Method.");
          return;
        }

        if (req.method === "POST") {
          let body = "";

          req.on("data", (chunk) => {
            body += chunk;
          });

          req.on("end", async () => {
            const data = JSON.parse(body);
            const statusCode = await insertLink(data.url, data.customId);
            res.writeHead(statusCode, { "Content-Type": "text/plain" });
            res.end();
          });

          return;
        }
      } else if (req.url.startsWith("/api/auth")) {
        if (req.method === "POST" && req.url === "/api/auth/register") {
          console.log("Entered auth register");
          let body = "";
          req.on("data", chunk => {
            body += chunk;
          });
          req.on("end", async () => {
            const data = JSON.parse(body);
            const statusCode = await registerUser(data.username, data.password);
            res.writeHead(statusCode, { "Content-Type": "text/plain"});
            res.end();
          })
        }
        if (req.method === "POST" && req.url === "/api/auth/login") {}
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
