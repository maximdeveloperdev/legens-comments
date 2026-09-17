import * as OTPAuth from "otpauth"
import QRCode from "qrcode"

const ISSUER = "Legends Comments"

export function createTotpSecret() {
  return new OTPAuth.Secret({ size: 20 }).base32
}

function makeTotp(label: string, secret: string) {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret,
  })
}

export function verifyTotpCode(label: string, secret: string, token: string) {
  const code = token.replace(/\s/g, "")
  if (!/^\d{6}$/.test(code)) return false
  return makeTotp(label, secret).validate({ token: code, window: 1 }) !== null
}

export async function createTotpQr(label: string, secret: string) {
  const uri = makeTotp(label, secret).toString()
  const qrDataUrl = await QRCode.toDataURL(uri, {
    margin: 1,
    width: 220,
    color: { dark: "#111111", light: "#ffffff" },
  })
  return { uri, qrDataUrl, secret }
}
