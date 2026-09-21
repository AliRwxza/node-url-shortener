import User from "./models/User.mjs";
import Link from "./models/Link.mjs";
import ClickEvent from "./models/ClickEvent.mjs";

User.hasMany(Link, {
  foreignKey: "userId"
});

Link.belongsTo(User, {
  foreignKey: "userId"
});
Link.hasMany(ClickEvent, {
  foreignKey: "linkId"
});

ClickEvent.belongsTo(Link, {
  foreignKey: "linkId"
});

export {
  User,
  Link,
  ClickEvent
};