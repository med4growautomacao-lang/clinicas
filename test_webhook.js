
const WH_URL = "https://webhook.med4growautomacao.com.br/webhook/v1/instance_connection/manager_clinica";
const payload = {
  event: 'whatsapp_connection_requested',
  action: 'connect',
  clinic_id: 'test-id',
  clinic_name: 'Clínica Teste Evento',
  timestamp: new Date().toISOString()
};

console.log("Enviando teste para:", WH_URL);

fetch(WH_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
})
.then(async res => {
  const text = await res.text();
  console.log(`Resposta (${res.status}):`, text);
})
.catch(err => {
  console.error("Erro no fetch:", err);
});
