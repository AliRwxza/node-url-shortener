import { DataTypes } from 'sequelize';
import { connection } from '../index.mjs';

const User = connection.define(
	"User",
	{
		id: {
			type: DataTypes.INTEGER.UNSIGNED,
			autoIncrement: true,
			primaryKey: true
		},
		username: {
			type: DataTypes.STRING(45),
			unique: true,
			allowNull: false
		},
		passwordHash: {
			type: DataTypes.STRING(255),
			allowNull: false
		}
	},
	{
		tableName: "users",
		underscored: true
	}
);

export default User;