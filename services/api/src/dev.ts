
import app from "./server";

const PORT = Number(process.env.PORT) || 3002;

const server = app.listen(PORT, "127.0.0.1", () => {
  console.log(`ChatLedger API running locally at http://127.0.0.1:${PORT}`);
});

function shutdown() {
  server.close(() => {
    console.log("ChatLedger API stopped.");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
