// worker.js
import { parentPort, workerData } from "worker_threads";
import ProxyManager from "../main/proxy.js";
import { SocketStream } from "../main/ws.js";

const { account, index, total } = workerData;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processAccount() {
  const proxyManager = new ProxyManager();
  const currentProxy = await proxyManager.getRandomProxy(index + 1, total);
  const socketStream = await SocketStream.create(account.email, account.password, currentProxy, index + 1, total);

  const randomDelay = Math.floor(Math.random() * 30000); // Maximum delay in 3 seconds
  console.log(`Delay ${Math.floor(randomDelay / 1000)}s before start...`);
  await delay(randomDelay);
  try {
    await socketStream.login();
    await socketStream.waitUntilReady();
    return { success: true, socketStream };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

processAccount().then((result) => {
  parentPort.postMessage(result);
});
