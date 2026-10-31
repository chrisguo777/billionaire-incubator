import { z } from "zod";

export const ContactSchema = z.object({
  name: z.string().trim().max(120), email: z.string().trim().max(254),
  phone: z.string().trim().max(80), link: z.string().trim().max(500),
});
export type Contact = z.infer<typeof ContactSchema>;
export type ContactMode = "full" | "private";
export const EMPTY_CONTACT: Contact = { name: "", email: "", phone: "", link: "" };
export const PLACEHOLDERS = ["[YOUR NAME]", "[YOUR EMAIL]", "[YOUR PHONE]"];
export const PRIVACY_NOTICE = "此模式生成的简历包含个人信息占位符。下载后，请自行填写并检查；如未替换就提交，可能导致招聘方无法联系你或系统解析不完整，相关后果需由你自行承担。";

// Best-effort redaction, not a name/address detector. Users must review the source text.
export function redactText(text: string, contact: Contact = EMPTY_CONTACT): string {
  let result = text;
  for (const [key, value] of Object.entries(contact).sort((a, b) => b[1].length - a[1].length)) {
    if (value.trim()) result = result.split(value.trim()).join(`[CONTACT_${key.toUpperCase()}]`);
  }
  return result.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[CONTACT_EMAIL]")
    .replace(/\+?\d[\d ().-]{7,}\d/g, (match) => {
      const count = match.replace(/\D/g, "").length;
      return count >= 10 && count <= 15 ? "[CONTACT_PHONE]" : match;
    });
}

export function redactPayload<T>(value: T, contact: Contact): T {
  if (typeof value === "string") return redactText(value, contact) as T;
  if (Array.isArray(value)) return value.map((v) => redactPayload(v, contact)) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactPayload(v, contact)])) as T;
  return value;
}

export function contactLines(mode: ContactMode, contact: Contact): string[] {
  return mode === "private" ? PLACEHOLDERS : [contact.name, [contact.email, contact.phone, contact.link].filter(Boolean).join(" | ")];
}

export function validateContact(contact: Contact): string | null {
  if (!contact.name || !contact.email || !contact.phone) return "请填写姓名、邮箱和电话，或选择隐私占位模式。";
  if (!z.email().safeParse(contact.email).success) return "请填写有效的邮箱地址。";
  if (contact.phone.replace(/\D/g, "").length < 5) return "请检查电话号码。";
  if (Object.values(contact).some((v) => /\[YOUR (NAME|EMAIL|PHONE)\]/i.test(v))) return "请替换个人信息占位符。";
  return null;
}
