// Sobrescreve (por ID) o cron de teste "external_api_selftest_once" que ficou
// preso rodando no processo antigo mesmo depois do arquivo original ser
// apagado — o Cron do PocketBase faz upsert por ID, então registrar de novo
// com uma função vazia deve neutralizar a versão antiga em memória.
cronAdd('external_api_selftest_once', '* * * * *', () => {})
cronAdd('external_api_audit_selftest', '* * * * *', () => {})
