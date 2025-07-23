import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";

export class SolanaWalletHelper {
  static createKeypairFromFile(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const privateKeyBase58 = fs.readFileSync(filePath, "utf8").trim();

      // Convert from base58 to uint8array
      const privateKeyArray = bs58.decode(privateKeyBase58);

      return this.createKeypairFromPrivateKey(privateKeyArray);
    } catch (error) {
      console.error("Error creating keypair from file:", error.message);
      return null;
    }
  }

  static generateKeypair() {
    const keypair = Keypair.generate();
    return {
      publicKey: keypair.publicKey.toString(),
      privateKey: Array.from(keypair.secretKey),
      keypair: keypair,
    };
  }

  static createKeypairFromPrivateKey(privateKeyArray) {
    return Keypair.fromSecretKey(Uint8Array.from(privateKeyArray));
  }

  static signMessage(message, privateKeyArray) {
    try {
      const keypair = this.createKeypairFromPrivateKey(privateKeyArray);
      const messageBytes = new TextEncoder().encode(message);
      const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
      return this.uint8ArrayToBase58(signature);
    } catch (error) {
      console.error("Error signing message:", error);
      return null;
    }
  }

  static uint8ArrayToBase58(uint8Array) {
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let encoded = "";
    let num = BigInt(
      "0x" +
        Array.from(uint8Array)
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join("")
    );

    while (num > 0) {
      const remainder = num % 58n;
      num = num / 58n;
      encoded = alphabet[Number(remainder)] + encoded;
    }

    for (let i = 0; i < uint8Array.length && uint8Array[i] === 0; i++) {
      encoded = "1" + encoded;
    }

    return encoded;
  }

  static privateKeyToBase58(privateKeyArray) {
    try {
      const uint8Array = Uint8Array.from(privateKeyArray);
      return this.uint8ArrayToBase58(uint8Array);
    } catch (error) {
      console.error("Error converting private key to Base58:", error);
      return null;
    }
  }

  static privateKeyToHex(privateKeyArray) {
    try {
      return Array.from(privateKeyArray)
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    } catch (error) {
      console.error("Error converting private key to hex:", error);
      return null;
    }
  }

  static privateKeyToJSON(privateKeyArray) {
    try {
      return JSON.stringify(privateKeyArray);
    } catch (error) {
      console.error("Error converting private key to JSON:", error);
      return null;
    }
  }

  static getPrivateKeyFormats(privateKeyArray) {
    return {
      base58: this.privateKeyToBase58(privateKeyArray),
      hex: this.privateKeyToHex(privateKeyArray),
      json: this.privateKeyToJSON(privateKeyArray),
      array: privateKeyArray,
    };
  }

  static isValidPublicKey(publicKey) {
    try {
      if (typeof publicKey !== "string") return false;
      if (publicKey.length < 32 || publicKey.length > 44) return false;
      const base58Regex = /^[1-9A-HJ-NP-Za-km-z]+$/;
      return base58Regex.test(publicKey);
    } catch (error) {
      return false;
    }
  }
}
