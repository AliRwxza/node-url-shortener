import { DataTypes } from 'sequelize';
import { connection } from '../index.mjs';

const Link = connection.define(
	"Link", 
	{
		id: {
			type: DataTypes.INTEGER.UNSIGNED,
			autoIncrement: true,
			primaryKey: true
		}, 
		alias: {
			type: DataTypes.STRING(20),
			unique: true,
			allowNull: false,
		},
		url: {
			type: DataTypes.TEXT,
			allowNull: false
		}, 
		userId: {
			type: DataTypes.INTEGER.UNSIGNED,
			allowNull: false
		},
		clickCount: {
			type: DataTypes.INTEGER.UNSIGNED,
			defaultValue: 0,
			allowNull: false
		},
		expiresAt: {
			type: DataTypes.DATE
		}
	},
	{
		tableName: "links",
		underscored: true
	}
);

export default Link;