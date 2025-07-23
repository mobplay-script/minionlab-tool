import chalk from "chalk";
import fs from "fs";
import MinionLab from "./main/minionLabConnect.js";
import ProxyManager from "./main/proxy.js";
import { logMessage, rl } from "./utils/logger.js";

async function main() {
  console.log(chalk.cyan(`Tool was developed by AirdropsVerse`));

  if (!fs.existsSync("../accounts.txt")) {
    console.log(chalk.red("accounts.txt file not found!"));
    console.log(chalk.yellow("Create accounts.txt with format: email:password"));
    process.exit(1);
  }

  const accounts = fs
    .readFileSync("../accounts.txt", "utf8")
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("#"))
    .map((line) => {
      const [email, password] = line.trim().split(":");
      return { email, password };
    });

  if (accounts.length === 0) {
    console.log(chalk.red("No accounts found in accounts.txt"));
    process.exit(1);
  }

  const count = accounts.length;
  console.log(chalk.green(`Found ${count} accounts to process`));

  const proxyManager = new ProxyManager();
  const proxiesLoaded = proxyManager.loadProxies();
  if (!proxiesLoaded) {
    logMessage(null, null, "No Proxy. Using default IP", "warning");
  }

  fs.writeFileSync("../result.txt", "# Solana Wallet Results\n# Format: email:privatekey\n\n");

  let privateKeys = [];
  const privateKeyFilePath = "../privateKeys_sol.txt";
  if (fs.existsSync(privateKeyFilePath)) {
    privateKeys = fs
      .readFileSync(privateKeyFilePath, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line);
  }

  let successful = 0;
  try {
    for (let i = 0; i < accounts.length; i++) {
      const account = accounts[i];
      console.log(chalk.white("-".repeat(85)));
      const currentProxy = await proxyManager.getRandomProxy(i + 1, count);
      const scrape = await MinionLab.create(currentProxy, i + 1, count);

      try {
        const result = await scrape.singleProses(account.email, account.password, privateKeys[i]);

        if (result) {
          fs.appendFileSync("../result.txt", `${result.email}:${result.privateKeyBase58}\n`);
          successful++;

          logMessage(i + 1, count, `Wallet connected for: ${result.email}`, "success");

          logMessage(i + 1, count, `Public Key: ${result.publicKey}`, "info");
        } else {
          logMessage(i + 1, count, `Failed to connect wallet for: ${account.email}`, "error");
        }
      } catch (error) {
        logMessage(i + 1, count, `Error processing ${account.email}: ${error.message}`, "error");
      }

      if (i < accounts.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  } finally {
    console.log(chalk.magenta("\n[*] Processing completed!"));
    console.log(chalk.green(`[*] Successfully connected ${successful} of ${count} wallets`));
    console.log(chalk.magenta("[*] Results saved in result.txt"));
    console.log(chalk.yellow("[*] Use the private keys from result.txt to import into your Solana wallet"));
    rl.close();
  }
}

main();
