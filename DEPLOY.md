# RAÍZES 360 — Guia de Deploy Gratuito (versão atualizada)
## App · Dashboard · API · Banco · WhatsApp · Recompensas

---

## Arquitetura completa do sistema

```
┌──────────────────────────────────────────────────────────────┐
│                      RAÍZES 360 — STACK                      │
├───────────────────────┬──────────────────────────────────────┤
│ App do paciente       │  Vercel           (gratuito)         │
│ Dashboard profissional│  Vercel           (gratuito)         │
│ API Node.js + Express │  Render           (gratuito)         │
│ Banco PostgreSQL      │  Supabase         (gratuito)         │
│ Fotos de refeições    │  Supabase Storage (gratuito, 1 GB)   │
│ WhatsApp Business     │  Z-API            (14 dias gratuito) │
└───────────────────────┴──────────────────────────────────────┘
Custo total mensal: R$ 0,00
```

### Arquivos que você tem neste projeto

```
raizes360-app-completo.html   → App do paciente (front-end)
raizes360-dashboard-v2.html  → Dashboard profissional (front-end)
raizes360-server.js          → API back-end (Node.js + Express)
raizes360-schema.sql         → Schema do banco de dados
raizes360-api-client.js      → Cliente de API para os front-ends
raizes360-env.example        → Modelo de variáveis de ambiente
raizes360-package.json       → Dependências do back-end
```

---

## PRÉ-REQUISITO — Instalar Git e Node.js

1. Git → git-scm.com/downloads → baixe e instale
2. Node.js 18+ → nodejs.org → baixe a versão LTS e instale

Verifique no terminal (Prompt de Comando no Windows, Terminal no Mac):
```bash
git --version
node --version
npm --version
```
Os três devem retornar números de versão sem erro.

---

## PASSO 1 — GitHub: criar conta e subir os arquivos

O GitHub é o repositório central. Render e Vercel fazem deploy automático a partir dele.

**1.1 Criar conta**

Acesse github.com → "Sign up" → crie conta com e-mail.

**1.2 Criar três repositórios**

Crie três repositórios separados (podem ser privados):

| Repositório | Arquivos que entram |
|-------------|---------------------|
| `raizes360-api` | `server.js` (renomeie de raizes360-server.js), `package.json` (renomeie de raizes360-package.json), `.env.example` (renomeie de raizes360-env.example) |
| `raizes360-app` | `index.html` (renomeie de raizes360-app-completo.html), `api-client.js` (renomeie de raizes360-api-client.js) |
| `raizes360-dash` | `index.html` (renomeie de raizes360-dashboard-v2.html), `api-client.js` (renomeie de raizes360-api-client.js) |

**1.3 Como fazer upload**

Para cada repositório:
1. Acesse github.com/new
2. Preencha o nome e clique em "Create repository"
3. Na tela seguinte clique em "uploading an existing file"
4. Arraste os arquivos correspondentes
5. Clique em "Commit changes"

Nunca faça upload do arquivo `.env` com senhas reais. Apenas o `.env.example`.

---

## PASSO 2 — Supabase: banco de dados

**2.1 Criar conta e projeto**

1. Acesse supabase.com → "Start your project"
2. Crie conta com GitHub
3. Clique em "New project" e preencha:
   - Name: `raizes360`
   - Database Password: senha forte — guarde
   - Region: `South America (São Paulo)`
4. Clique em "Create new project" e aguarde 2–3 minutos

**2.2 Executar o schema principal**

1. No painel do Supabase → **SQL Editor** → **New query**
2. Abra o arquivo `raizes360-schema.sql` no seu computador
3. Selecione tudo (Ctrl+A), copie (Ctrl+C), cole no editor (Ctrl+V)
4. Clique em **Run**
5. Aguarde `Success. No rows returned`

Isso cria as 9 tabelas: `users`, `checklist_entries`, `daily_summary`, `patient_points`, `menu_items`, `exam_results`, `meal_photos`, `notifications`, `clinical_notes`.

**2.3 Criar tabela de recompensas**

No SQL Editor, execute:

```sql
create table rewards (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  description       text,
  trigger_type      text not null check (trigger_type in ('points','level')),
  trigger_value     text not null,
  delivery_type     text not null check (delivery_type in ('whatsapp','manual','physical','coupon')),
  limit_per_patient int default 1,
  active            boolean default true,
  created_by        uuid references users(id),
  created_at        timestamptz default now()
);

create table reward_redemptions (
  id           uuid primary key default gen_random_uuid(),
  reward_id    uuid not null references rewards(id),
  patient_id   uuid not null references users(id),
  status       text default 'pending' check (status in ('pending','approved','delivered','cancelled')),
  approved_by  uuid references users(id),
  approved_at  timestamptz,
  delivered_at timestamptz,
  notes        text,
  created_at   timestamptz default now(),
  unique (reward_id, patient_id)
);

create index idx_redemptions_patient on reward_redemptions(patient_id);
create index idx_redemptions_status  on reward_redemptions(status);
```

**2.4 Criar bucket de fotos**

1. Menu lateral → **Storage** → **New bucket**
2. Name: `meal-photos`
3. Public bucket: desativado
4. Clique em **Save**

**2.5 Copiar credenciais**

Menu lateral → **Settings** → **API**:
- Copie o **Project URL** → será `SUPABASE_URL`
- Copie a **service_role key** (clique em "Reveal") → será `SUPABASE_SERVICE_ROLE_KEY`

A service_role key é secreta. Nunca publique no GitHub.

---

## PASSO 3 — Render: back-end / API

**3.1 Criar conta**

Acesse render.com → "Get Started for Free" → crie conta com GitHub.

**3.2 Criar o serviço Web**

1. No painel → **New +** → **Web Service**
2. Autorize o acesso ao GitHub e selecione o repositório `raizes360-api`
3. Preencha:

| Campo | Valor |
|-------|-------|
| Name | `raizes360-api` |
| Region | `Ohio, USA` |
| Branch | `main` |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | `Free` |

4. Clique em **Advanced** e adicione as variáveis de ambiente:

```
SUPABASE_URL              = https://SEU_PROJETO.supabase.co
SUPABASE_SERVICE_ROLE_KEY = eyJhbGci... (copiada no passo 2.5)
JWT_SECRET                = (gere abaixo)
APP_URL                   = https://raizes360-app.vercel.app
DASHBOARD_URL             = https://raizes360-dash.vercel.app
PORT                      = 3000
```

Para gerar o JWT_SECRET, execute no terminal:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

5. Clique em **Create Web Service**
6. Aguarde 5–10 minutos até aparecer `Your service is live`
7. Anote a URL: `https://raizes360-api.onrender.com`

**3.3 Verificar**

Abra no navegador:
```
https://raizes360-api.onrender.com/health
```
Resposta esperada: `{"status":"ok","ts":...}`

Limitação do plano gratuito: o serviço hiberna após 15 min sem uso. A primeira requisição após hibernação leva ~30s. Para MVP é suficiente. Para uso comercial, o plano Starter ($7/mês) elimina a hibernação.

---

## PASSO 4 — Preparar os front-ends

**4.1 Editar `api-client.js` nos dois repositórios**

Abra o arquivo no GitHub (clique → lápis) e confirme que a linha está correta:
```javascript
const BASE_URL = 'https://raizes360-api.onrender.com';
```
Se a URL do Render foi diferente, atualize aqui.

**4.2 Adicionar o script no app do paciente**

No `index.html` do repositório `raizes360-app`, adicione antes do `</body>`:

```html
<script src="api-client.js"></script>
<script>
  document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('r360_token');
    if (!token) { console.log('Modo demo'); return; }
    try {
      const pts = await Points.me();
      document.getElementById('prog-pts').textContent =
        pts.total_points.toLocaleString('pt-BR');
      document.getElementById('prog-streak').textContent = pts.streak_days;
    } catch (e) { console.error(e); }
  });
</script>
```

**4.3 Adicionar o script no dashboard**

No `index.html` do repositório `raizes360-dash`, adicione antes do `</body>`:

```html
<script src="api-client.js"></script>
<script>
  document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('r360_token');
    if (!token) { console.log('Modo demo'); return; }
    try {
      const patients = await Patients.list();
      console.log('Pacientes:', patients.length);
    } catch (e) { console.error(e); }
  });
</script>
```

---

## PASSO 5 — Vercel: front-end

**5.1 Criar conta**

Acesse vercel.com → "Start Deploying" → crie conta com GitHub.

**5.2 Deploy do app do paciente**

1. No painel → **Add New Project** → **Import** ao lado de `raizes360-app`
2. Framework Preset: `Other`
3. Clique em **Deploy**
4. URL gerada: `https://raizes360-app.vercel.app`

**5.3 Deploy do dashboard**

1. Repita para `raizes360-dash`
2. URL gerada: `https://raizes360-dash.vercel.app`

**5.4 Atualizar URLs no Render**

1. Render → seu serviço → **Environment**
2. Atualize `APP_URL` e `DASHBOARD_URL` com as URLs reais geradas
3. Clique em **Save Changes** — o Render faz redeploy automático

---

## PASSO 6 — Cadastrar usuários e recompensas no banco

**6.1 Gerar hashes de senha**

No terminal do seu computador:
```bash
node -e "
const bcrypt = require('bcryptjs');
const usuarios = [
  { email: 'juan@seuemail.com',   senha: 'DefiniaSuaSenha' },
  { email: 'carlos@seuemail.com', senha: 'DefiniaSuaSenha' },
  { email: 'lucia@seuemail.com',  senha: 'DefiniaSuaSenha' },
  { email: 'pedro@seuemail.com',  senha: 'DefiniaSuaSenha' },
  { email: 'ana@seuemail.com',    senha: 'DefiniaSuaSenha' },
];
usuarios.forEach(async u => {
  const hash = await bcrypt.hash(u.senha, 12);
  console.log(u.email + ' -> ' + hash);
});
"
```

Se der erro: `npm install bcryptjs` e execute novamente.

**6.2 Atualizar senhas no Supabase**

SQL Editor → execute para cada usuário:
```sql
update users
set password_hash = '$2a$12$HASH_GERADO_AQUI'
where email = 'juan@seuemail.com';
```

**6.3 Inserir recompensas**

SQL Editor:
```sql
insert into rewards
  (name, description, trigger_type, trigger_value, delivery_type, limit_per_patient)
values
  ('Consulta de retorno grátis', 'Consulta extra com o nutricionista', 'points', '500',    'manual',   1),
  ('E-book Guia de Crononutrição','PDF enviado via WhatsApp',          'points', '1500',   'whatsapp', 1),
  ('Sessão extra com psicólogo', 'Sessão individual agendada',         'level',  'prata',  'manual',   1),
  ('Desconto 20% na renovação',  'Cupom aplicável na renovação',       'level',  'ouro',   'coupon',   1),
  ('Kit Raízes 360 exclusivo',   'Kit físico enviado pelos Correios',  'level',  'diamante','physical', 1);
```

---

## PASSO 7 — WhatsApp Business via Z-API (opcional)

**7.1 Criar conta**

Acesse z-api.io → "Criar conta grátis" — 14 dias de teste completo.

**7.2 Conectar o número**

1. No painel → **Criar instância**
2. Escaneie o QR Code com o WhatsApp do número remetente
3. Aguarde confirmação

**7.3 Copiar credenciais**

Na instância criada, copie o **Instance ID** e o **Token**.

**7.4 Adicionar ao Render**

Render → seu serviço → Environment:
```
WHATSAPP_INSTANCE_ID = seu_instance_id
WHATSAPP_TOKEN       = seu_token
```

**7.5 Testar envio**

```bash
curl -X POST \
  "https://api.z-api.io/instances/SEU_ID/token/SEU_TOKEN/send-text" \
  -H "Content-Type: application/json" \
  -d '{"phone":"5511999990000","message":"Teste Raízes 360"}'
```

---

## PASSO 8 — Testes finais

Execute na ordem:

```bash
# 1. API no ar
curl https://raizes360-api.onrender.com/health

# 2. Login de profissional
curl -X POST https://raizes360-api.onrender.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"juan@seuemail.com","password":"SuaSenha"}'
# Guarde o token retornado como TOKEN

# 3. Salvar checklist como paciente
curl -X POST https://raizes360-api.onrender.com/checklist \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-05-16","pilar":"nutri","habit_id":"nutri_01","habit_name":"Café da manhã proteico","completed":true,"points":15}'

# 4. Ver ranking
curl https://raizes360-api.onrender.com/ranking \
  -H "Authorization: Bearer TOKEN"
```

Depois confirme no Supabase → Table Editor → `checklist_entries` que o registro aparece.

Por fim, abra no navegador:
- `https://raizes360-app.vercel.app`
- `https://raizes360-dash.vercel.app`

---

## PASSO 9 — Domínio personalizado (opcional)

Sem configuração extra, você já tem subdomínios funcionais do Vercel.

Para domínio próprio:
1. Registre em registro.br (~R$40/ano) ou namecheap.com (~$10/ano)
2. Vercel → seu projeto → **Settings** → **Domains** → **Add Domain**
3. Configure os registros DNS conforme indicado pelo Vercel
4. Aguarde até 1h para propagação

---

## Resumo das URLs finais

| Serviço | URL | Plataforma | Custo |
|---------|-----|-----------|-------|
| App do paciente | https://raizes360-app.vercel.app | Vercel | Gratuito |
| Dashboard | https://raizes360-dash.vercel.app | Vercel | Gratuito |
| API | https://raizes360-api.onrender.com | Render | Gratuito |
| Banco | gerenciado pelo Supabase | Supabase | Gratuito |
| Fotos | Supabase Storage | Supabase | Gratuito (1 GB) |
| WhatsApp | z-api.io | Z-API | 14 dias grátis |

---

## Limites gratuitos

| Plataforma | Limite | Impacto |
|-----------|--------|---------|
| Supabase | 500 MB banco · 1 GB storage | Suporta até ~200 pacientes |
| Render | 750h/mês · hiberna 15 min | Suficiente para MVP |
| Vercel | 100 GB bandwidth/mês | Sem limitação prática |
| Z-API | 14 dias grátis | Plano pago ~R$69/mês |

---

## Quando pagar

| Pacientes ativos | Ação recomendada | Custo |
|-----------------|-----------------|-------|
| 0–30 | Stack 100% gratuita | R$ 0/mês |
| 30–100 | Render Starter (sem hibernação) | ~R$40/mês |
| 100–500 | Render + Supabase Pro | ~R$150/mês |
| 500+ | VPS próprio (Railway ou DigitalOcean) | ~R$300/mês |

---

## Checklist de deploy

- [ ] Git e Node.js instalados
- [ ] Repositórios `raizes360-api`, `raizes360-app`, `raizes360-dash` criados no GitHub
- [ ] Supabase: projeto criado, schema principal executado, tabela de recompensas criada, bucket `meal-photos` criado, credenciais copiadas
- [ ] Render: serviço criado, variáveis configuradas, API respondendo em `/health`
- [ ] Vercel: dois projetos deployados, URLs geradas
- [ ] Render: `APP_URL` e `DASHBOARD_URL` atualizadas com URLs do Vercel
- [ ] Usuários cadastrados com hashes reais
- [ ] Recompensas inseridas no banco
- [ ] Scripts adicionados nos dois `index.html`
- [ ] WhatsApp conectado via Z-API (opcional)
- [ ] Todos os testes do Passo 8 passando
- [ ] Front-ends abrindo no navegador sem erros no console
