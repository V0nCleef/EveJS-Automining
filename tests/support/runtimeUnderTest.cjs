"use strict";
const path = require("node:path");
const file = process.env.LOGIN_DELIVERY_RUNTIME ? path.resolve(process.env.LOGIN_DELIVERY_RUNTIME) :
  path.resolve(__dirname, "../../lib/loginDeliveryRuntime.js");
module.exports = { file, api: require(file) };
