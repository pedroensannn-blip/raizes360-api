/**
 * RAÍZES 360 — Back-end Principal
 * Stack: Node.js + Express + Supabase (PostgreSQL)
 * Autor: gerado para o projeto Raízes 360
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

const app = express();

// ─── SUPABASE CLIENT ────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // service role — apenas no servidor
);

// ─── MIDDLEWARES GLOBAIS ────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: [
    process.env.APP_URL,        // ex: https://raizes360-app.vercel.app
    process.env.DASHBOARD_URL,  // ex: https://raizes360-dash.vercel.app
  ],
  credentials: true,
}));
app.use(express.json());

// Rate limit global — 100 req/min por IP
app.use(rateLimit({ windowMs: 60_000, max: 100 }));

// ─── MIDDLEWARE DE AUTENTICAÇÃO ─────────────────────────────────────
function auth(roles = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Token ausente' });
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ error: 'Acesso negado para este perfil' });
      }
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Token inválido ou expirado' });
    }
  };
}

// ════════════════════════════════════════════════════════════════════
//  PARTE 1 — AUTENTICAÇÃO
// ════════════════════════════════════════════════════════════════════

/**
 * POST /auth/login
 * Body: { email, password }
 * Funciona para pacientes E profissionais — a role está no banco.
 */
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });

  // Busca o usuário independente da tabela (view unificada)
  const { data: user, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase())
    .single();

  if (error || !user)
    return res.status(401).json({ error: 'Credenciais inválidas' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid)
    return res.status(401).json({ error: 'Credenciais inválidas' });

  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role, email: user.email }
  });
});

/**
 * POST /auth/register (apenas admin/profissional pode criar pacientes)
 */
app.post('/auth/register', auth(['admin', 'nutricionista']), async (req, res) => {
  const { name, email, password, role = 'paciente' } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Campos obrigatórios: name, email, password' });

  const hash = await bcrypt.hash(password, 12);

  const { data, error } = await supabase
    .from('users')
    .insert({ name, email: email.toLowerCase(), password_hash: hash, role })
    .select('id, name, email, role')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
});

/**
 * GET /auth/me — retorna dados do usuário logado
 */
app.get('/auth/me', auth(), async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('id, name, email, role, created_at')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(data);
});

// ════════════════════════════════════════════════════════════════════
//  PARTE 2 — CHECKLIST (6 PILARES MEV)
// ════════════════════════════════════════════════════════════════════

/**
 * GET /checklist/:date
 * Retorna o checklist do paciente para uma data (YYYY-MM-DD)
 * Paciente vê o próprio. Profissional passa ?patient_id=
 */
app.get('/checklist/:date', auth(), async (req, res) => {
  const patientId = req.query.patient_id ?? req.user.id;

  // Profissionais podem ver qualquer paciente. Pacientes só o próprio.
  if (req.user.role === 'paciente' && patientId !== req.user.id)
    return res.status(403).json({ error: 'Acesso negado' });

  const { data, error } = await supabase
    .from('checklist_entries')
    .select('*')
    .eq('patient_id', patientId)
    .eq('date', req.params.date);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/**
 * POST /checklist
 * Salva ou atualiza um item do checklist.
 * Body: { date, pilar, habit_id, habit_name, completed, points }
 */
app.post('/checklist', auth(['paciente']), async (req, res) => {
  const { date, pilar, habit_id, habit_name, completed, points } = req.body;

  const { data, error } = await supabase
    .from('checklist_entries')
    .upsert({
      patient_id: req.user.id,
      date,
      pilar,
      habit_id,
      habit_name,
      completed,
      points: completed ? points : 0,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'patient_id,date,habit_id' })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  // Recalcula pontos totais do dia e atualiza daily_summary
  await recalcDailySummary(req.user.id, date);

  res.json(data);
});

/**
 * GET /checklist/summary/:patient_id
 * Retorna resumo diário dos últimos 30 dias (para gráficos do dashboard)
 * Somente profissionais
 */
app.get('/checklist/summary/:patient_id', auth(['nutricionista','educador_fisico','psicologo','medico','admin']), async (req, res) => {
  const { data, error } = await supabase
    .from('daily_summary')
    .select('*')
    .eq('patient_id', req.params.patient_id)
    .order('date', { ascending: false })
    .limit(30);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Função interna — recalcula o resumo diário após cada check
async function recalcDailySummary(patientId, date) {
  const { data: entries } = await supabase
    .from('checklist_entries')
    .select('pilar, completed, points')
    .eq('patient_id', patientId)
    .eq('date', date);

  if (!entries) return;

  const pilares = ['nutri','ativ','sono','mente','social','vicios'];
  const summary = {};
  let totalPoints = 0;

  for (const p of pilares) {
    const items = entries.filter(e => e.pilar === p);
    const done  = items.filter(e => e.completed).length;
    const total = items.length;
    summary[`${p}_done`]  = done;
    summary[`${p}_total`] = total;
    summary[`${p}_pct`]   = total > 0 ? Math.round((done / total) * 100) : 0;
  }

  totalPoints = entries.filter(e => e.completed).reduce((s, e) => s + (e.points || 0), 0);

  await supabase
    .from('daily_summary')
    .upsert({
      patient_id:  patientId,
      date,
      total_points: totalPoints,
      ...summary,
      updated_at:  new Date().toISOString(),
    }, { onConflict: 'patient_id,date' });
}

// ════════════════════════════════════════════════════════════════════
//  PARTE 3 — PONTOS, NÍVEIS E RANKING
// ════════════════════════════════════════════════════════════════════

const LEVELS = [
  { name: 'Bronze',   min: 0     },
  { name: 'Prata',    min: 2000  },
  { name: 'Ouro',     min: 6000  },
  { name: 'Diamante', min: 15000 },
];

function getLevel(points) {
  let level = LEVELS[0];
  for (const l of LEVELS) { if (points >= l.min) level = l; }
  const idx  = LEVELS.indexOf(level);
  const next = LEVELS[idx + 1] ?? null;
  return { current: level, next, progress: next
    ? Math.round(((points - level.min) / (next.min - level.min)) * 100)
    : 100 };
}

/**
 * GET /points/me — pontos e nível do paciente logado
 */
app.get('/points/me', auth(['paciente']), async (req, res) => {
  const { data, error } = await supabase
    .from('patient_points')
    .select('*')
    .eq('patient_id', req.user.id)
    .single();

  if (error) return res.status(404).json({ error: 'Dados não encontrados' });

  res.json({ ...data, level: getLevel(data.total_points) });
});

/**
 * GET /ranking — top 10 do grupo (pacientes)
 */
app.get('/ranking', auth(), async (req, res) => {
  const { data, error } = await supabase
    .from('patient_points')
    .select('patient_id, total_points, streak_days, users(name)')
    .order('total_points', { ascending: false })
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });

  const ranked = data.map((r, i) => ({
    position:     i + 1,
    patient_id:   r.patient_id,
    name:         r.users.name,
    total_points: r.total_points,
    streak_days:  r.streak_days,
    level:        getLevel(r.total_points).current.name,
  }));

  res.json(ranked);
});

// ════════════════════════════════════════════════════════════════════
//  PARTE 4 — CARDÁPIO (nutricionista → paciente)
// ════════════════════════════════════════════════════════════════════

/**
 * GET /menu/:patient_id/:date
 * Paciente busca o próprio cardápio do dia.
 * Profissional busca qualquer paciente.
 */
app.get('/menu/:patient_id/:date', auth(), async (req, res) => {
  const { patient_id, date } = req.params;

  if (req.user.role === 'paciente' && patient_id !== req.user.id)
    return res.status(403).json({ error: 'Acesso negado' });

  const { data, error } = await supabase
    .from('menu_items')
    .select('*')
    .eq('patient_id', patient_id)
    .eq('date', date)
    .order('meal_order');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/**
 * PUT /menu/:patient_id/:date
 * Nutricionista salva/atualiza cardápio completo do dia.
 * Body: { meals: [ { meal_name, meal_time, items: [{name,qty,kcal}] } ] }
 */
app.put('/menu/:patient_id/:date', auth(['nutricionista','admin']), async (req, res) => {
  const { patient_id, date } = req.params;
  const { meals } = req.body;

  // Remove cardápio anterior do dia
  await supabase.from('menu_items').delete()
    .eq('patient_id', patient_id).eq('date', date);

  const rows = [];
  meals.forEach((meal, mIdx) => {
    meal.items.forEach((item, iIdx) => {
      rows.push({
        patient_id,
        date,
        meal_order:   mIdx,
        meal_name:    meal.meal_name,
        meal_time:    meal.meal_time,
        item_order:   iIdx,
        item_name:    item.name,
        quantity:     item.qty,
        kcal:         item.kcal,
        note:         item.note ?? null,
        is_sub:       item.is_sub ?? false,
        created_by:   req.user.id,
      });
    });
  });

  const { data, error } = await supabase.from('menu_items').insert(rows).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ════════════════════════════════════════════════════════════════════
//  PARTE 5 — EXAMES CLÍNICOS
// ════════════════════════════════════════════════════════════════════

/**
 * GET /exams/:patient_id — histórico de exames
 */
app.get('/exams/:patient_id', auth(), async (req, res) => {
  const { patient_id } = req.params;

  if (req.user.role === 'paciente' && patient_id !== req.user.id)
    return res.status(403).json({ error: 'Acesso negado' });

  const { data, error } = await supabase
    .from('exam_results')
    .select('*')
    .eq('patient_id', patient_id)
    .order('exam_date', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/**
 * POST /exams — paciente ou médico insere exame
 * Body: { patient_id?, exam_date, results: { glicemia, vitamina_d, ... } }
 */
app.post('/exams', auth(), async (req, res) => {
  const { patient_id, exam_date, results } = req.body;
  const pid = req.user.role === 'paciente' ? req.user.id : patient_id;

  const { data, error } = await supabase
    .from('exam_results')
    .insert({ patient_id: pid, exam_date, results, inserted_by: req.user.id })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// ════════════════════════════════════════════════════════════════════
//  PARTE 6 — FEEDBACK DE FOTOS (WhatsApp → painel)
// ════════════════════════════════════════════════════════════════════

/**
 * GET /photos/:patient_id — lista fotos aguardando feedback
 */
app.get('/photos/:patient_id', auth(['nutricionista','admin']), async (req, res) => {
  const { data, error } = await supabase
    .from('meal_photos')
    .select('*')
    .eq('patient_id', req.params.patient_id)
    .order('sent_at', { ascending: false })
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/**
 * POST /photos/:photo_id/feedback — nutricionista envia feedback
 * Body: { feedback_text, tags: ['Proteína ok', ...] }
 */
app.post('/photos/:photo_id/feedback', auth(['nutricionista','admin']), async (req, res) => {
  const { feedback_text, tags } = req.body;

  const { data, error } = await supabase
    .from('meal_photos')
    .update({
      feedback_text,
      tags,
      feedback_by: req.user.id,
      feedback_at: new Date().toISOString(),
      status: 'reviewed',
    })
    .eq('id', req.params.photo_id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
  // Aqui você dispara a notificação WhatsApp (ver whatsapp.js)
});

// ════════════════════════════════════════════════════════════════════
//  PARTE 7 — PACIENTES (dashboard profissional)
// ════════════════════════════════════════════════════════════════════

/**
 * GET /patients — lista todos os pacientes (profissionais)
 */
app.get('/patients', auth(['nutricionista','educador_fisico','psicologo','medico','admin']), async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, name, email, created_at,
      patient_points ( total_points, streak_days ),
      daily_summary ( date, total_points )
    `)
    .eq('role', 'paciente')
    .order('name');

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

/**
 * GET /patients/:id — dados completos de um paciente
 */
app.get('/patients/:id', auth(['nutricionista','educador_fisico','psicologo','medico','admin']), async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select(`
      id, name, email, created_at,
      patient_points ( * ),
      daily_summary ( * ),
      exam_results ( * )
    `)
    .eq('id', req.params.id)
    .single();

  if (error) return res.status(404).json({ error: 'Paciente não encontrado' });
  res.json(data);
});

// ─── HEALTH CHECK ───────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─── INICIALIZAÇÃO ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Raízes 360 API rodando na porta ${PORT}`));
