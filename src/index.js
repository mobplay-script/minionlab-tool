import chalk from "chalk";
import fs from "fs";
import MinionlabAutoreff from "./main/minionlabAutoreff.js";
import ProxyManager from "./main/proxy.js";
import { logMessage, prompt, rl } from "./utils/logger.js";

async function main() {
  console.log(chalk.cyan(`Tool was developed by AirdropsVerse`));

  const count = parseInt(await prompt(chalk.yellow("How many ref do you want? ")));
  const refCode = await prompt(chalk.yellow("Enter your referral code? "));

  const proxyManager = new ProxyManager();
  const proxiesLoaded = proxyManager.loadProxies();
  if (!proxiesLoaded) {
    logMessage(null, null, "No Proxy. Using default IP", "warning");
  }

  const accounts = fs.createWriteStream("../accounts.txt", { flags: "a" });
  let successful = 0;
  let attempt = 1;

  try {
    while (successful < count) {
      console.log(chalk.white("-".repeat(85)));
      const currentProxy = await proxyManager.getRandomProxy(successful + 1, count);
      const scrape = await MinionlabAutoreff.create(refCode, currentProxy, successful + 1, count);
      try {
        const account = await scrape.singleProses();

        if (account) {
          accounts.write(`${account.email}:${account.password}\n`);
          successful++;
          logMessage(successful, count, `Account create succesfully : ${account.email}`, "success");
          attempt = 1;
        } else {
          logMessage(successful + 1, count, "Register Account Failed, retrying...", "error");
          attempt++;
        }
      } catch (error) {
        logMessage(successful + 1, count, `Error: ${error.message}, retrying...`, "error");
        attempt++;
      }
    }
  } finally {
    accounts.end();
    console.log(chalk.green(`[*] Completed ${successful} accounts`));
    console.log(chalk.magenta("[*] Result in accounts.txt"));
    rl.close();
  }
}

main();
