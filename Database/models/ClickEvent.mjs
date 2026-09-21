import { DataTypes } from 'sequelize';
import { connection } from '../index.mjs';

const ClickEvent = connection.define(
	"ClickEvent", 
	{
		id: {
			type: DataTypes.BIGINT.UNSIGNED,
			allowNull: false,
			primaryKey: true,
			autoIncrement: true
		}, 
		linkId: {
			type: DataTypes.INTEGER.UNSIGNED,
			allowNull: false
		},
		ipAddress: {
			type: DataTypes.STRING(45)
		},
		userAgent: {
			type: DataTypes.TEXT,
		},
		referrer: {
			type: DataTypes.TEXT
		}
	},
	{
		tableName: "click_events",
		underscored: true
	}
);

export default ClickEvent;

