import mysql from "mysql2/promise";
import { Sequelize } from 'sequelize';

const connection = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: "mysql",

    logging: console.log
  }
);

const initDB = async () => {
  const rawConnection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  });

  await rawConnection.query(
    `CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`
  );

  await rawConnection.end();
  
  await connection.authenticate();
  console.log("connected to database");

  await connection.sync({ alter: true });
}

export {
  connection,
  initDB
}