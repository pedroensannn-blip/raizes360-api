// ════════════════════════════════════════════════════════════════════
//  RAÍZES 360 — Novas Rotas API
//  Funcionalidades: Gestão de Acesso + Arquivados + Orientações
//  Adicionar ao raizes360-server.js
// ════════════════════════════════════════════════════════════════════

// ── HELPER: middleware de autenticação (já existe no server.js) ─────
// auth(roles) — verifica JWT e role do usuário

// ════════════════════════════════════════════════════════════════════
//  FUNCIONALIDADE 1 — GESTÃO DE ACESSO
// ════════════════════════════════════════════════════════════════════

// PAUSAR PACIENTE — move para Arquivados, revoga acesso no app
app.post('/patients/:id/pause', auth(['nutricionista','admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({
        status:    'paused',
        paused_at: new Date().toISOString(),
        paused_by: req.user.id,
      })
      .eq('id', req.params.id)
      .eq('role', 'paciente')   // segurança: só pausa pacientes
      .select('id, name, status, paused_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Notifica o paciente via push/WhatsApp se integrado
    await supabase.from('notifications').insert({
      patient_id: req.params.id,
      from_user:  req.user.id,
      type:       'acesso',
      title:      'Acesso temporariamente suspenso',
      message:    'Seu acesso ao Raízes 360 foi pausado. Entre em contato com seu profissional.',
    }).catch(() => {}); // não bloqueia se falhar

    res.json({ ...data, message: `${data.name} pausado com sucesso.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// REATIVAR PACIENTE — restaura o acesso
app.post('/patients/:id/reactivate', auth(['nutricionista','admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({ status: 'active', paused_at: null, paused_by: null })
      .eq('id', req.params.id)
      .select('id, name, status')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ...data, message: `${data.name} reativado com sucesso.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// EXCLUIR PACIENTE — soft delete (mantém histórico, remove acesso)
app.delete('/patients/:id', auth(['nutricionista','admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .update({ status: 'deleted' })
      .eq('id', req.params.id)
      .select('id, name')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ...data, message: `${data.name} excluído permanentemente.` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DEFINIR TEMPO LIMITE DE ACESSO
// Body: { access_limit: "2026-12-31" } ou { access_limit: null } para remover
app.patch('/patients/:id/access-limit', auth(['nutricionista','admin']), async (req, res) => {
  try {
    const { access_limit } = req.body;
    const { data, error } = await supabase
      .from('users')
      .update({ access_limit: access_limit || null })
      .eq('id', req.params.id)
      .select('id, name, access_limit')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    res.json({
      ...data,
      message: access_limit
        ? `Acesso de ${data.name} expira em ${new Date(access_limit).toLocaleDateString('pt-BR')}`
        : 'Limite de acesso removido.'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════
//  FUNCIONALIDADE 2 — PACIENTES ARQUIVADOS
// ════════════════════════════════════════════════════════════════════

// LISTAR ARQUIVADOS — todos os pacientes com status 'paused'
app.get('/patients/archived', auth(['nutricionista','educador_fisico','psicologo','medico','admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select(`
        id, name, email, phone, status, paused_at, access_limit,
        patient_points ( total_points, nivel ),
        patient_orientations ( phase, next_visit )
      `)
      .eq('role', 'paciente')
      .eq('status', 'paused')
      .order('paused_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// LISTAR ATIVOS — pacientes com status 'active' e acesso não expirado
app.get('/patients/active', auth(['nutricionista','educador_fisico','psicologo','medico','admin']), async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('users')
      .select(`
        id, name, email, phone, status, access_limit,
        patient_points ( total_points, nivel ),
        patient_orientations ( phase, goal, next_visit, updated_at )
      `)
      .eq('role', 'paciente')
      .eq('status', 'active')
      .or(`access_limit.is.null,access_limit.gte.${today}`)
      .order('name');

    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ════════════════════════════════════════════════════════════════════
//  FUNCIONALIDADE 3 — ORIENTAÇÕES PROFISSIONAL → APP
// ════════════════════════════════════════════════════════════════════

// SALVAR ORIENTAÇÕES — profissional escreve, paciente lê no app
// Body: { orientations, goal, next_visit, phase }
app.put('/patients/:id/orientations', auth(['nutricionista','educador_fisico','psicologo','medico','admin']), async (req, res) => {
  try {
    const { orientations, goal, next_visit, phase } = req.body;

    const { data, error } = await supabase
      .from('patient_orientations')
      .upsert(
        {
          patient_id:   req.params.id,
          author_id:    req.user.id,
          orientations: orientations || null,
          goal:         goal         || null,
          next_visit:   next_visit   || null,
          phase:        phase        || null,
          updated_at:   new Date().toISOString(),
        },
        { onConflict: 'patient_id' }  // atualiza se já existe
      )
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    // Notifica o paciente de que há novas orientações
    await supabase.from('notifications').insert({
      patient_id: req.params.id,
      from_user:  req.user.id,
      type:       'orientacao',
      title:      'Orientações atualizadas!',
      message:    'Seu profissional atualizou suas orientações e metas. Confira no app!',
    }).catch(() => {});

    res.json({ ...data, message: 'Orientações salvas e enviadas ao paciente.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// BUSCAR ORIENTAÇÕES — chamado pelo app do paciente ao abrir o planner
app.get('/my/orientations', auth(['paciente']), async (req, res) => {
  try {
    // 1. Verifica se o acesso está ativo
    const { data: user } = await supabase
      .from('users')
      .select('id, name, status, access_limit')
      .eq('id', req.user.id)
      .single();

    if (user?.status === 'paused') {
      return res.status(403).json({
        error:   'access_revoked',
        message: 'Seu acesso foi temporariamente suspenso. Entre em contato com seu profissional.',
      });
    }
    if (user?.status === 'deleted') {
      return res.status(403).json({
        error:   'access_deleted',
        message: 'Conta removida. Entre em contato com seu profissional.',
      });
    }
    if (user?.access_limit) {
      const expiry = new Date(user.access_limit + 'T23:59:59');
      if (new Date() > expiry) {
        return res.status(403).json({
          error:      'access_expired',
          expired_at: user.access_limit,
          message:    `Seu acesso expirou em ${expiry.toLocaleDateString('pt-BR')}. Entre em contato com seu profissional para renovar.`,
        });
      }
    }

    // 2. Busca orientações
    const { data, error } = await supabase
      .from('patient_orientations')
      .select(`
        orientations, goal, next_visit, phase, updated_at,
        users!author_id ( name, role )
      `)
      .eq('patient_id', req.user.id)
      .single();

    if (error) return res.json(null); // sem orientações ainda é OK
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// BUSCAR PERFIL COMPLETO DO PACIENTE (dashboard)
app.get('/patients/:id/profile', auth(['nutricionista','educador_fisico','psicologo','medico','admin']), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select(`
        id, name, email, phone, status, access_limit, paused_at,
        patient_points ( total_points, nivel ),
        patient_orientations ( orientations, goal, next_visit, phase, updated_at )
      `)
      .eq('id', req.params.id)
      .single();

    if (error) return res.status(404).json({ error: 'Paciente não encontrado.' });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
