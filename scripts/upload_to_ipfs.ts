import fs from "fs";
import path from "path";
import axios from "axios";
import FormData from "form-data";

async function uploadToPinata() {
  console.log("====================================================");
  console.log("🚀 开始将 $GSOUL ($0x.SOUL) 图标与元数据上传至 Pinata IPFS");
  console.log("====================================================");

  // 使用您安全提供的 Pinata JWT 令牌
  const jwtToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiJkZDU5OTgyYi05ZTAxLTQ5YTEtYmU4OS04OGZmYmM3NTgwZTkiLCJlbWFpbCI6InBpYW9zaHUxMTEyQGdtYWlsLmNvbSIsImVtYWlsX3ZlcmlmaWVkIjp0cnVlLCJwaW5fcG9saWN5Ijp7InJlZ2lvbnMiOlt7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6IkZSQTEifSx7ImRlc2lyZWRSZXBsaWNhdGlvbkNvdW50IjoxLCJpZCI6Ik5ZQzEifV0sInZlcnNpb24iOjF9LCJtZmFfZW5hYmxlZCI6ZmFsc2UsInN0YXR1cyI6IkFDVElWRSJ9LCJhdXRoZW50aWNhdGlvblR5cGUiOiJzY29wZWRLZXkiLCJzY29wZWRLZXlLZXkiOiIyZTE4ZDYwZjQ3OWY4MWEzNjc2MSIsInNjb3BlZEtleVNlY3JldCI6ImY2MGM1MzZkMmIwM2M3N2E0YmVjNjcwMzA1YTUxODIyM2NkNDU3NjQ1NjY4Y2IzMTc3ZTUwZWFjZTViMzViZDQiLCJleHAiOjE4MjU1MzM1NTN9.CT1dS8vNnJWCtLCMm_bYVQKVBdc0RPxdlrHqt7he-uk";

  const pinataApiKey = "2e18d60f479f81a36761";
  const pinataSecretApiKey = "f60c536d2b03c77a4bec670305a518223cd457645668cb3177e50eace5b35bd4";

  const svgFilePath = path.join(process.cwd(), "public", "gsoul_token_icon.svg");
  if (!fs.existsSync(svgFilePath)) {
    throw new Error(`找不到图标文件: ${svgFilePath}`);
  }

  const url = "https://api.pinata.cloud/pinning/pinFileToIPFS";
  const data = new FormData();
  data.append("file", fs.createReadStream(svgFilePath), {
    filepath: "gsoul_token_icon.svg",
  });

  const metadata = JSON.stringify({
    name: "0x.SOUL Token Icon ($GSOUL)",
  });
  data.append("pinataMetadata", metadata);

  const pinataOptions = JSON.stringify({
    cidVersion: 1,
  });
  data.append("pinataOptions", pinataOptions);

  console.log("📦 正在将 SVG 图标推送至 Pinata IPFS 节点...");

  try {
    const res = await axios.post(url, data, {
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        ...data.getHeaders(),
        Authorization: `Bearer ${jwtToken}`,
      },
    });

    const imageIpfsHash = res.data.IpfsHash;
    const imageUrl = `ipfs://${imageIpfsHash}/gsoul_token_icon.svg` || `https://gateway.pinata.cloud/ipfs/${imageIpfsHash}`;
    
    console.log("====================================================");
    console.log(`🎉 图标成功上传至 IPFS!`);
    console.log(`📍 Image IPFS Hash (CID): ${imageIpfsHash}`);
    console.log(`🌐 访问网关链接: https://gateway.pinata.cloud/ipfs/${imageIpfsHash}`);
    console.log("====================================================");

    // 自动生成符合标准的 meta.json
    const metaJson = {
      name: "0x.SOUL Pioneer",
      symbol: "0x.SOUL",
      description: "Autonomous AI Agent-First Meme Launchpad & Trading Engine on Solana & ARC.",
      image: `https://gateway.pinata.cloud/ipfs/${imageIpfsHash}`,
      external_url: "https://0xsoul.xyz",
      attributes: [
        { trait_type: "Protocol", value: "0xsoul.xyz" },
        { trait_type: "Standard", value: "ARC EVM & Solana SPL Dual-Meme" },
        { trait_type: "Security Badge", value: "Verified Decentralized Agent Asset" }
      ],
      properties: {
        files: [
          {
            uri: `https://gateway.pinata.cloud/ipfs/${imageIpfsHash}`,
            type: "image/svg+xml"
          }
        ],
        category: "image"
      }
    };

    const metaFilePath = path.join(process.cwd(), "public", "meta.json");
    fs.writeFileSync(metaFilePath, JSON.stringify(metaJson, null, 2));
    console.log(`📝 已自动生成标准化 meta.json 并在本地更新: ${metaFilePath}`);

    // 上传 meta.json 到 IPFS
    const metaData = new FormData();
    metaData.append("file", fs.createReadStream(metaFilePath), {
      filepath: "meta.json",
    });
    metaData.append("pinataMetadata", JSON.stringify({ name: "0x.SOUL Token Metadata (meta.json)" }));
    metaData.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));

    console.log("📦 正在将 meta.json 推送至 Pinata IPFS 节点...");
    const metaRes = await axios.post(url, metaData, {
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      headers: {
        ...metaData.getHeaders(),
        Authorization: `Bearer ${jwtToken}`,
      },
    });

    const metaIpfsHash = metaRes.data.IpfsHash;
    console.log("====================================================");
    console.log(`🎉 元数据成功上传至 IPFS!`);
    console.log(`📍 Meta IPFS Hash (CID): ${metaIpfsHash}`);
    console.log(`🌐 最终标准化 URI 回执: https://gateway.pinata.cloud/ipfs/${metaIpfsHash}`);
    console.log("====================================================");

  } catch (error: any) {
    console.error("❌ Pinata 上传异常:", error.response?.data || error.message);
  }
}

uploadToPinata();
