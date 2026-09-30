// Entrypoint para cPanel / Phusion Passenger
const path = require('path');
const fs = require('fs');

process.on('uncaughtException', (err) => {
  const logMsg = `[${new Date().toISOString()}] Uncaught Exception: ${err.stack || err}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, 'passenger_crash.log'), logMsg);
  } catch (e) {}
  console.error(logMsg);
});

process.on('unhandledRejection', (reason, promise) => {
  const logMsg = `[${new Date().toISOString()}] Unhandled Rejection: ${reason?.stack || reason}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, 'passenger_crash.log'), logMsg);
  } catch (e) {}
  console.error(logMsg);
});

try {
  require('./backend/app.js');
} catch (err) {
  const logMsg = `[${new Date().toISOString()}] Startup Crash: ${err.stack || err}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, 'passenger_crash.log'), logMsg);
  } catch (e) {}
  console.error(logMsg);
  throw err;
}
