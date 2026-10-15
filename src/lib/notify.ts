import "server-only";

/**
 * Sends one alert message by SMS or WhatsApp. Providers are configured with
 * environment variables; with none set, messages stay queued in the
 * notifications table (visible to admins) and nothing is sent.
 *
 *   WhatsApp: Meta WhatsApp Cloud API   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
 *   SMS:      Africa's Talking          AT_USERNAME, AT_API_KEY, AT_SENDER_ID (optional)
 *   Either:   your own gateway          NOTIFY_WEBHOOK_URL (+ NOTIFY_WEBHOOK_SECRET)
 */
export async function sendNotification(channel: "sms" | "whatsapp", to: string, body: string): Promise<void> {
  const phone = to.replace(/[^\d+]/g, "");

  if (channel === "whatsapp" && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
    const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: phone.replace(/^\+/, ""), type: "text", text: { body } }),
    });
    if (!res.ok) throw new Error(`WhatsApp ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }

  if (channel === "sms" && process.env.AT_USERNAME && process.env.AT_API_KEY) {
    const params = new URLSearchParams({ username: process.env.AT_USERNAME, to: phone, message: body.slice(0, 459) });
    if (process.env.AT_SENDER_ID) params.set("from", process.env.AT_SENDER_ID);
    const res = await fetch("https://api.africastalking.com/version1/messaging", {
      method: "POST",
      headers: { apiKey: process.env.AT_API_KEY, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: params,
    });
    if (!res.ok) throw new Error(`SMS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return;
  }

  if (process.env.NOTIFY_WEBHOOK_URL) {
    const res = await fetch(process.env.NOTIFY_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Notify-Secret": process.env.NOTIFY_WEBHOOK_SECRET ?? "" },
      body: JSON.stringify({ channel, to: phone, body }),
    });
    if (!res.ok) throw new Error(`Webhook ${res.status}`);
    return;
  }

  throw new NotConfigured();
}

export class NotConfigured extends Error {
  constructor() {
    super("No SMS/WhatsApp provider configured");
  }
}
