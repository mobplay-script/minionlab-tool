import axios from "axios";
import chalk from "chalk";
import UserAgent from "user-agents";
import WebSocket from "ws";
import { logMessage } from "../utils/logger.js";
import ProxyManager from "./proxy.js";

export class SocketStream {
  constructor(email, password, proxy = null, currentNum, total) {
    this.email = email;
    this.password = password;
    this.currentNum = currentNum;
    this.total = total;
    this.proxy = proxy;
    this.ws = null;
    this.browserId = "";
    this.userId = "";
    this.accessToken = "";
    this.gatewayServer = "";
    this.pingInterval = null;
    this.proxyManager = new ProxyManager();
  }

  static async create(email, password, proxy = null, currentNum, total) {
    const instance = new SocketStream(email, password, proxy, currentNum, total);
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

  async login() {
    const loginUrl = "https://api.minionlab.ai/web/v1/auth/emailLogin";
    const data = {
      email: this.email,
      password: this.password,
    };

    try {
      const response = await this.makeRequest("POST", loginUrl, { data });
      if (response && response.data) {
        const { data: responseData } = response.data;
        this.userId = responseData.user.uuid;
        this.accessToken = responseData.token;
        this.browserId = this.generateBrowserId();
        logMessage(this.currentNum, this.total, `Login successfully for ${this.email}`, "success");
        await this.dispatchGateway();
      }
    } catch (error) {
      logMessage(this.currentNum, this.total, `Login failed for ${this.email}: ${error.message}`, "error");
    }
  }

  async waitUntilReady() {
    return new Promise((resolve) => {
      const checkReady = async () => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          logMessage(this.currentNum, this.total, `Account ${this.currentNum} is fully ready`, "success");
          resolve();
        } else {
          setTimeout(checkReady, 1000);
        }
      };
      checkReady();
    });
  }

  generateBrowserId() {
    const characters = "abcdef0123456789";
    let browserId = "";
    for (let i = 0; i < 32; i++) {
      browserId += characters[Math.floor(Math.random() * characters.length)];
    }
    return browserId;
  }
  async connectWebSocket() {
    if (!this.gatewayServer) {
      logMessage(this.currentNum, this.total, "No gateway server available", "error");
      return;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const url = `wss://${this.gatewayServer}/connect`;
    const wsOptions = this.proxy
      ? {
          agent: await this.proxyManager.getProxyAgent(this.proxy, this.currentNum, this.total),
        }
      : undefined;
    this.ws = new WebSocket(url, wsOptions);

    this.ws.onopen = () => {
      logMessage(this.currentNum, this.total, `WebSocket connected for account ${this.currentNum}`, "success");
      this.sendRegisterMessage();
      this.startPinging();
    };

    this.ws.onmessage = (event) => {
      let rawData = event.data.toString();
      if (rawData === "pong") {
        return;
      }
      if (rawData.startsWith("{") && rawData.endsWith("}")) {
        try {
          const message = JSON.parse(rawData);
          this.handleMessage(message);
        } catch (error) {
          logMessage(this.currentNum, this.total, `Error parsing JSON: ${error.message}`, "error");
        }
      }
    };

    this.ws.onclose = (event) => {
      logMessage(this.currentNum, this.total, `WebSocket disconnected for account ${this.currentNum} (Code: ${event.code})`, "warning");

      if (event.code !== 1000) {
        this.reconnectWebSocket();
      }
    };

    this.ws.onerror = (error) => {
      logMessage(this.currentNum, this.total, `WebSocket error for account ${this.currentNum}: ${error.message}`, "error");
    };
  }

  sendRegisterMessage() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = {
        type: "register",
        user: this.userId,
        dev: this.browserId,
      };

      this.ws.send(JSON.stringify(message));
      logMessage(this.currentNum, this.total, `Registered browser for account ${this.currentNum}`, "success");
    }
  }

  async handleMessage(message) {
    if (message.type === "request") {
      const { taskid, data } = message;
      const { method, url, headers, body, timeout = 15000 } = data;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const fetchOptions = {
          method,
          headers,
          signal: controller.signal,
        };

        if (method === "POST" && body) {
          const decodedBody = this.isBase64(body) ? atob(body) : body;
          fetchOptions.body = decodedBody;
        }

        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        const responseText = await response.text();
        const encodedResponse = btoa(encodeURIComponent(responseText));

        this.ws?.send(
          JSON.stringify({
            type: "response",
            taskid,
            result: {
              parsed: "",
              html: encodedResponse,
              rawStatus: response.status,
            },
          })
        );
      } catch (error) {
        this.ws?.send(
          JSON.stringify({
            type: "error",
            taskid,
            error: error.message,
            errorCode: error.name === "AbortError" ? 50000002 : 50000001,
            rawStatus: -1,
          })
        );
      }
    } else {
      logMessage(this.currentNum, this.total, `Unhandled message type: ${message.type}`, "warning");
    }
  }

  isBase64(str) {
    try {
      return btoa(atob(str)) === str;
    } catch {
      return false;
    }
  }

  startPinging() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 20000);

    setInterval(() => {
      this.refreshGateway();
    }, 60000);

    const pingServer = async () => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        await this.realTime();
      }

      setTimeout(pingServer, 60000);
    };

    pingServer();
  }

  async realTime() {
    const mobileHomeUrl = `https://api.allstream.ai/mobile/v1/home?imei=${this.browserId}`;
    try {
      const response = await this.makeRequest("GET", mobileHomeUrl, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
      });

      if (response && response.data && response.data.data) {
        const { data } = response.data;
        console.log(chalk.white("-".repeat(85)));
        const message = `Account ${this.currentNum} | Total Points: ${data.totalPoints ?? 0} | Today Points: ${data.todayPoints ?? 0} | Device Points: ${data.devicePoints ?? 0} | Earnings:${
          data.earnings ?? 0
        }`;
        logMessage(this.currentNum, this.total, message, "success");
        logMessage(this.currentNum, this.total, `Online Status = ${data.online ? "Online" : "Offline"}`, data.online ? "success" : "error");

        if (data.currentEpoch) {
          logMessage(this.currentNum, this.total, `Current Epoch = ${data.currentEpoch.name} (${data.currentEpoch.status})`, "debug");
        }
      }
    } catch (error) {
      logMessage(this.currentNum, this.total, `Error retrieving points for ${this.email}: ${error.message}`, "error");
    }
  }

  reconnectWebSocket() {
    logMessage(this.currentNum, this.total, "Reconnecting WebSocket...", "warning");

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    setTimeout(() => {
      this.dispatchGateway();
    }, 3000);
  }

  async refreshGateway() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const dispatchUrl = "https://dist.streamapp365.com/dispatch";
      try {
        const response = await this.makeRequest("POST", dispatchUrl, {
          data: {
            user: this.userId,
            dev: this.browserId,
          },
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (response && response.data && response.data.server) {
          this.gatewayServer = response.data.server;
          logMessage(this.currentNum, this.total, `Gateway refreshed: ${this.gatewayServer}`, "debug");
        }
      } catch (error) {
        logMessage(this.currentNum, this.total, `Gateway refresh failed: ${error.message}`, "error");
      }
    }
  }

  async dispatchGateway() {
    const dispatchUrl = "https://dist.streamapp365.com/dispatch";

    try {
      const response = await this.makeRequest("POST", dispatchUrl, {
        data: {
          user: this.userId,
          dev: this.browserId,
        },
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response && response.data && response.data.server) {
        const newGatewayServer = response.data.server;
        logMessage(this.currentNum, this.total, `Gateway server: ${newGatewayServer}`, "debug");

        if (newGatewayServer !== this.gatewayServer || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.gatewayServer = newGatewayServer;
          await this.connectWebSocket();
        } else {
          this.gatewayServer = newGatewayServer;
        }
      } else {
        logMessage(this.currentNum, this.total, "Failed to get gateway server", "error");
      }
    } catch (error) {
      logMessage(this.currentNum, this.total, `Dispatch failed: ${error.message}`, "error");
    }
  }
}
