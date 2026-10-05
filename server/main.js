import { start } from "./index.js";

const port = Number(process.env.PORT ?? 8787);
const tunnel = process.env.NO_TUNNEL !== "1";

let app;
try {
  app = await start({ port, tunnel });
} catch (err) {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${port} is already in use. Stop the other server or run with PORT=<another port>.`);
  } else {
    console.error(err);
  }
  process.exit(1);
}

console.log(`Local:  ${app.localUrl}`);
if (app.publicUrl) {
  console.log(`Public: ${app.publicUrl}`);
  console.log("Links work only while this server and your Mac stay on. Restarting makes a new address and old links stop working.");
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
