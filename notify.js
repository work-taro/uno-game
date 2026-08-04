async function notifyDiscord(message) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("ยังไม่ได้ตั้งค่า DISCORD_WEBHOOK_URL");
    return;
  }
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });
  } catch (err) {
    console.error("ส่ง Discord ไม่สำเร็จ:", err);
  }
}

module.exports = { notifyDiscord };
