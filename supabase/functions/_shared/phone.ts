// Normaliza um numero de WhatsApp para o formato brasileiro padrao
// (sem o '9' adicional no celular). Mesma logica que ja existia no n8n.
export function normalizeBrazilianPhone(rawInput: string | null | undefined): string | null {
  if (!rawInput) return null;
  let phone = String(rawInput).replace(/\D/g, '');
  if (!phone) return null;
  phone = phone.replace(/^0+/, '');

  const stripExtra9 = (digits: string): string => {
    if (digits.length === 13 && digits.startsWith('55')) {
      const country = digits.slice(0, 2);
      const ddd = digits.slice(2, 4);
      let rest = digits.slice(4);
      if (rest.startsWith('9')) rest = rest.slice(1);
      return country + ddd + rest;
    }
    return digits;
  };

  if (phone.startsWith('55')) {
    return stripExtra9(phone);
  }

  if (phone.length === 10 || phone.length === 11) {
    phone = '55' + phone;
    return stripExtra9(phone);
  }

  return phone;
}

// Extrai apenas o numero local do dono da instancia uazapi (campo 'owner').
// Owner pode vir como '5511999999999@s.whatsapp.net' ou apenas '5511999999999'.
export function ownerToPhone(owner: string | null | undefined): string | null {
  if (!owner) return null;
  const stripped = String(owner).split('@')[0] ?? '';
  return normalizeBrazilianPhone(stripped);
}
