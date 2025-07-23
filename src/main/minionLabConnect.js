import axios from "axios";
import UserAgent from "user-agents";
import { logMessage } from "../utils/logger.js";
import { SolanaWalletHelper } from "../utils/solanaHelper.js";
import ProxyManager from "../main/proxy.js";
import fs from "fs";

export default class MinionLab {
  constructor(proxy = null, currentNum, total) {
    this.proxy = proxy;
    this.currentNum = currentNum;
    this.total = total;
    this.userAgent = new UserAgent().toString();
    this.proxyManager = new ProxyManager();
  }

  static async create(proxy = null, currentNum, total) {
    const instance = new MinionLab(proxy, currentNum, total);
    await instance.init();
    return instance;
  }

  async init() {
    await this.initAxios();
  }

  async initAxios() {
    this.axios = axios.create({
      httpsAgent: this.proxy ? await this.proxyManager.getProxyAgent(this.proxy, this.currentNum, this.total) : undefined,
      timeout: 120000,
      headers: {
        "User-Agent": new UserAgent().toString(),
        accept: "application/json",
        "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
        "cache-control": "no-cache",
        "content-type": "application/json; charset=UTF-8",
        expires: "0",
        pragma: "no-cache",
        priority: "u=1, i",
        "sec-ch-ua": '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        Referer: "https://app.minionlab.ai/",
        "Referrer-Policy": "strict-origin-when-cross-origin",
      },
    });
  }

  async makeRequest(method, url, config = {}, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await this.axios({ method, url, ...config });
      } catch (error) {
        const errorData = error.response ? error.response.data : error.message;
        logMessage(this.currentNum, this.total, `Request failed: ${error.message}`, "error");
        logMessage(this.currentNum, this.total, `Error response data: ${JSON.stringify(errorData, null, 2)}`, "error");

        logMessage(this.currentNum, this.total, `Retrying... (${i + 1}/${retries})`, "process");
        await new Promise((resolve) => setTimeout(resolve, 12000));
      }
    }
    return null;
  }

  async loginaccount(email, password) {
    logMessage(this.currentNum, this.total, "Trying to get access token", "process");

    const payload = {
      email,
      password,
    };

    try {
      const response = await this.makeRequest("POST", "https://api.minionlab.ai/web/v1/auth/emailLogin", {
        data: payload,
      });
      if (response.data && response.data.code === 0) {
        logMessage(this.currentNum, this.total, "Login successful", "success");
        return response.data.data.token;
      }
    } catch (error) {
      logMessage(this.currentNum, this.total, `Error logging in, message: ${error.message}`, "error");
      return null;
    }
  }

  async connectSolanaWallet(token, publicKey, privateKeyArray = null) {
    logMessage(this.currentNum, this.total, "Starting Solana wallet connection process", "process");

    if (!SolanaWalletHelper.isValidPublicKey(publicKey)) {
      logMessage(this.currentNum, this.total, "Invalid Solana public key format", "error");
      return null;
    }

    const connectResult = await this.connectSolWallet(token, publicKey);
    if (!connectResult) {
      logMessage(this.currentNum, this.total, "Failed to connect Solana wallet", "error");
      return null;
    }

    logMessage(this.currentNum, this.total, "Got connect token, proceeding to signature verification", "process");

    const signature = await this.generateSignature(connectResult.message, privateKeyArray);
    if (!signature) {
      logMessage(this.currentNum, this.total, "Failed to generate signature", "error");
      return null;
    }

    const verifyResult = await this.verifySolSignature(token, publicKey, signature, connectResult.connectToken);
    if (!verifyResult) {
      logMessage(this.currentNum, this.total, "Failed to verify signature", "error");
      return null;
    }

    logMessage(this.currentNum, this.total, "Signature verified, binding wallet", "process");

    const bindResult = await this.bindSolWallet(token, verifyResult.authToken, publicKey);
    if (!bindResult) {
      logMessage(this.currentNum, this.total, "Failed to bind Solana wallet", "error");
      return null;
    }

    logMessage(this.currentNum, this.total, "Solana wallet connected successfully", "success");

    return bindResult;
  }

  async connectSolWallet(token, publicKey) {
    logMessage(this.currentNum, this.total, "Requesting connect token from Solana wallet", "process");

    const payload = {
      publicKey,
    };

    try {
      const response = await this.makeRequest("POST", "https://api.minionlab.ai/web/v1/wallet/connectSolWallet", {
        data: payload,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      if (response && response.data && response.data.code === 0) {
        logMessage(this.currentNum, this.total, "Connect token received successfully", "success");
        return response.data.data;
      } else {
        logMessage(this.currentNum, this.total, `Failed to get connect token: ${response?.data?.message || "Unknown error"}`, "error");
        return null;
      }
    } catch (error) {
      logMessage(this.currentNum, this.total, `Error connecting Solana wallet: ${error.message}`, "error");
      return null;
    }
  }

  async generateSignature(message, privateKeyArray = null) {
    logMessage(this.currentNum, this.total, `Generating signature for message: ${message}`, "process");

    if (!privateKeyArray) {
      logMessage(this.currentNum, this.total, "No private key provided, generating new keypair", "warning");
      const newKeypair = SolanaWalletHelper.generateKeypair();
      privateKeyArray = newKeypair.privateKey;

      logMessage(this.currentNum, this.total, `Generated new public key: ${newKeypair.publicKey}`, "info");
    }

    try {
      const signature = SolanaWalletHelper.signMessage(message, privateKeyArray);

      if (signature) {
        logMessage(this.currentNum, this.total, "Signature generated successfully", "success");
        return signature;
      } else {
        logMessage(this.currentNum, this.total, "Failed to generate signature", "error");
        return null;
      }
    } catch (error) {
      logMessage(this.currentNum, this.total, `Error generating signature: ${error.message}`, "error");
      return null;
    }
  }

  async verifySolSignature(token, publicKey, signature, connectToken) {
    logMessage(this.currentNum, this.total, "Verifying Solana signature", "process");

    const payload = {
      publicKey,
      signature,
      connectToken,
    };

    try {
      const response = await this.makeRequest("POST", "https://api.minionlab.ai/web/v1/wallet/verifySolSignature", {
        data: payload,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      if (response && response.data && response.data.code === 0) {
        logMessage(this.currentNum, this.total, "Signature verified successfully", "success");
        return response.data.data;
      } else {
        logMessage(this.currentNum, this.total, `Failed to verify signature: ${response?.data?.message || "Unknown error"}`, "error");
        return null;
      }
    } catch (error) {
      logMessage(this.currentNum, this.total, `Error verifying signature: ${error.message}`, "error");
      return null;
    }
  }

  async bindSolWallet(token, authToken, publicKey) {
    logMessage(this.currentNum, this.total, "Binding Solana wallet to account", "process");

    const payload = {
      authToken,
      publicKey,
    };

    try {
      const response = await this.makeRequest("POST", "https://api.minionlab.ai/web/v1/wallet/bindSolWallet", {
        data: payload,
        headers: {
          authorization: `Bearer ${token}`,
        },
      });

      if (response && response.data && response.data.code === 0) {
        logMessage(this.currentNum, this.total, "Solana wallet bound successfully", "success");
        return response.data.data;
      } else {
        logMessage(this.currentNum, this.total, `Failed to bind wallet: ${response?.data?.message || "Unknown error"}`, "error");
        return null;
      }
    } catch (error) {
      logMessage(this.currentNum, this.total, `Error binding wallet: ${error.message}`, "error");
      return null;
    }
  }

  async singleProses(email, password, privatekey) {
    try {
      logMessage(this.currentNum, this.total, `Processing account: ${email}`, "process");

      const token = await this.loginaccount(email, password);
      if (!token) {
        logMessage(this.currentNum, this.total, "Login failed, skipping account", "error");
        return null;
      }

      let wallet;

      if (privatekey) {
        logMessage(this.currentNum, this.total, "Found existing private key, loading wallet", "info");
        wallet = SolanaWalletHelper.createKeypairFromPrivateKey(privatekey);
      } else {
        logMessage(this.currentNum, this.total, "No private key found, generating new wallet", "warning");
        wallet = SolanaWalletHelper.generateKeypair();
        logMessage(this.currentNum, this.total, `New wallet generated and saved: ${wallet.publicKey}`, "info");
      }

      const result = await this.connectSolanaWallet(token, wallet.publicKey, wallet.privateKey);

      if (result) {
        const privateKeyBase58 = SolanaWalletHelper.privateKeyToBase58(wallet.privateKey);

        logMessage(this.currentNum, this.total, "Wallet connected successfully", "success");

        return {
          email,
          publicKey: wallet.publicKey,
          privateKeyBase58,
          userInfo: result.user,
        };
      } else {
        logMessage(this.currentNum, this.total, "Failed to connect wallet", "error");
        return null;
      }
    } catch (error) {
      logMessage(this.currentNum, this.total, `Error in single process: ${error.message}`, "error");
      return null;
    }
  }
}
