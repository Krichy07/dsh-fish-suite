window.__ModuleLoader__.load({
  id: 'dsh-fish-suite',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'dsh-fish-suite'
    const API = '/dsh-fish-suite/api'
    const DIMS = [
      ['happy', '开心'],
      ['calm', '平静'],
      ['sweet', '甜'],
      ['heartache', '心疼'],
      ['worry', '担心'],
      ['sad', '难过'],
      ['jealous', '吃醋'],
    ]

    function Icon() {
      return h('svg', {
        width: 20,
        height: 20,
        viewBox: '0 0 24 24',
        fill: 'none',
        'aria-hidden': true,
        style: { display: 'block' },
      },
        h('path', {
          d: 'M3.5 12c2.8-3.7 7.2-5.2 11.2-3.6l3.8-2.9-.9 4.6 3 2-3 2 .9 4.6-3.8-2.9C10.7 17.2 6.3 15.7 3.5 12Z',
          fill: 'currentColor',
          opacity: 0.9,
        }),
        h('circle', { cx: 14.2, cy: 11.2, r: 1.1, fill: 'var(--dsw-alias-bg-layer-1, #10263b)' }),
      )
    }

    function StatBar({ label, value }) {
      const safe = Math.max(0, Math.min(100, Number(value) || 0))
      return h('div', { style: { display: 'grid', gridTemplateColumns: '52px 1fr 34px', gap: 8, alignItems: 'center' } },
        h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, label),
        h('div', {
          style: {
            height: 6,
            borderRadius: 999,
            background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.18))',
            overflow: 'hidden',
          },
        }, h('div', {
          style: {
            width: `${safe}%`,
            height: '100%',
            borderRadius: 999,
            background: 'var(--dsw-alias-brand-primary, #7fd4ff)',
          },
        })),
        h('span', { style: { fontSize: 11, textAlign: 'right', color: 'var(--dsw-alias-label-secondary)' } }, String(Math.round(safe))),
      )
    }

    function normalizePath(value) {
      return String(value || '').trim().replace(/[\\/]+$/, '').toLowerCase()
    }

    function PanelPage({ sessionId, onBack, onOpenSession }) {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState('')
      const [busyPath, setBusyPath] = React.useState('')
      const [selectedSession, setSelectedSession] = React.useState(sessionId || '')
      const [initialized, setInitialized] = React.useState(false)
      const activeSessionId = selectedSession || sessionId || ''

      const load = React.useCallback(async () => {
        try {
          const response = await fetch(`${API}/state?session=${encodeURIComponent(activeSessionId)}`, { cache: 'no-store' })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          setData(await response.json())
          setError('')
        } catch (reason) {
          setError(String(reason?.message || reason))
        }
      }, [activeSessionId])

      React.useEffect(() => {
        let alive = true
        const tick = async () => {
          if (alive) await load()
        }
        void tick()
        const timer = setInterval(tick, 5000)
        return () => {
          alive = false
          clearInterval(timer)
        }
      }, [load])

      React.useEffect(() => {
        if (initialized || !data) return
        const preferred = data.focusSession || data.sessionId || sessionId || ''
        if (preferred) setSelectedSession(preferred)
        setInitialized(true)
        if (!data.focusSession && preferred) {
          void fetch(`${API}/focus`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: preferred }),
          }).catch(() => {})
        }
      }, [data, initialized, sessionId])

      async function selectSession(session) {
        if (!session) return
        setSelectedSession(session)
        try {
          const response = await fetch(`${API}/focus`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
        } catch (reason) {
          setError(String(reason?.message || reason))
        }
      }

      async function togglePath(targetPath) {
        if (!targetPath || busyPath) return
        const enabled = (data?.whitelist || []).includes(normalizePath(targetPath))
        setBusyPath(targetPath)
        try {
          const response = await fetch(`${API}/whitelist`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              path: targetPath,
              enabled: !enabled,
            }),
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          await load()
        } catch (reason) {
          setError(String(reason?.message || reason))
        } finally {
          setBusyPath('')
        }
      }

      if (!data) {
        return h('div', {
          style: { padding: 32, color: 'var(--dsw-alias-label-secondary)', fontSize: 13 },
        }, error || '正在读取鱼记忆与心情…')
      }

      const mood = data.mood || {}
      const moodValue = Number.isFinite(Number(mood.value)) ? Math.round(Number(mood.value)) : null
      const memory = Array.isArray(data.memory) ? data.memory : []
      const whitelist = Array.isArray(data.whitelist) ? data.whitelist : []
      const workspaces = Array.isArray(data.workspaces) && data.workspaces.length
        ? data.workspaces
        : data.workspace
          ? [{
              workspaceId: 'current',
              path: data.workspace,
              title: '当前工作区',
              sessionIds: sessionId ? [sessionId] : [],
            }]
          : []
      const sessionOptions = []
      const seenSessions = new Set()
      const sessionRows = Array.isArray(data.sessions) ? data.sessions : []
      for (const row of sessionRows) {
        const sid = String(row.sessionId || '')
        if (!sid || seenSessions.has(sid)) continue
        seenSessions.add(sid)
        const workspace = String(row.workspace || '工作区')
        const title = String(row.title || '').trim() || '未命名对话'
        sessionOptions.push({ sid, label: `${workspace} · ${title} · ${sid.slice(0, 6)}` })
      }
      if (sessionOptions.length === 0) {
        for (const workspace of workspaces) {
          const title = String(workspace.title || workspace.path || '工作区')
          for (const sid of Array.isArray(workspace.sessionIds) ? workspace.sessionIds : []) {
            if (seenSessions.has(sid)) continue
            seenSessions.add(sid)
            sessionOptions.push({ sid, label: `${title} · 未命名对话 · ${sid.slice(0, 6)}` })
          }
        }
      }
      if (activeSessionId && !seenSessions.has(activeSessionId)) {
        sessionOptions.unshift({ sid: activeSessionId, label: `当前 · 未命名对话 · ${activeSessionId.slice(0, 6)}` })
      }

      return h('div', {
        style: {
          padding: '28px 32px 64px',
          maxWidth: 980,
          height: '100%',
          overflowY: 'auto',
          alignContent: 'start',
          display: 'grid',
          gap: 18,
          color: 'var(--dsw-alias-label-primary)',
          boxSizing: 'border-box',
        },
      },
        h('header', { style: { display: 'grid', gap: 6 } },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 } },
              h('span', { style: { color: 'var(--dsw-alias-brand-primary)', display: 'flex' } }, h(Icon)),
              h('h1', { style: { margin: 0, fontSize: 22, fontWeight: 650 } }, '鱼记忆 / 心情'),
            ),
            h('button', {
              type: 'button',
              onClick: () => {
                if (activeSessionId && onOpenSession) {
                  try {
                    onOpenSession(activeSessionId)
                  } catch {
                    onBack?.()
                  }
                } else {
                  onBack?.()
                }
              },
              style: {
                flex: 'none',
                border: '1px solid var(--dsw-alias-separator, rgba(127,127,127,.3))',
                borderRadius: 7,
                padding: '5px 12px',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                fontSize: 12,
              },
            }, '返回对话'),
          ),
          h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '按工作区启用；未启用的工作区不注册记忆工具，也不注入心情/记忆段落。'),
        ),

        h('section', {
          style: {
            display: 'grid',
            gap: 8,
            padding: '12px 16px',
            border: '1px solid var(--dsw-alias-separator, rgba(127,127,127,.22))',
            borderRadius: 10,
          },
        },
          h('label', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '当前查看的会话'),
          h('select', {
            value: activeSessionId,
            onChange: (event) => selectSession(event.target.value),
            style: {
              width: '100%',
              maxWidth: 520,
              border: '1px solid var(--dsw-alias-separator, rgba(127,127,127,.3))',
              borderRadius: 7,
              padding: '6px 8px',
              background: 'var(--dsw-alias-bg-layer-1, transparent)',
              color: 'inherit',
              fontSize: 12,
            },
          },
            sessionOptions.length
              ? sessionOptions.map((option) => h('option', { key: option.sid, value: option.sid }, option.label))
              : h('option', { value: '' }, '没有可选会话'),
          ),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '只对选中的会话生效；其他会话和其他工作区不挂 remember，也不注入心情。'),
        ),

        h('section', {
          style: {
            display: 'grid',
            gap: 10,
            padding: '16px',
            border: '1px solid var(--dsw-alias-separator, rgba(127,127,127,.22))',
            borderRadius: 10,
            background: 'var(--dsw-alias-bg-layer-2, rgba(127,127,127,.06))',
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
            h('h2', { style: { margin: 0, fontSize: 15 } }, '工作区'),
            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, `${workspaces.length} 个`),
          ),
          workspaces.length === 0
            ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, '还没有可显示的工作区。')
            : h('div', { style: { display: 'grid', gap: 8 } },
                workspaces.map((workspace) => {
                  const workspacePath = String(workspace.path || '')
                  const enabled = whitelist.includes(normalizePath(workspacePath))
                  const current = normalizePath(workspacePath) === normalizePath(data.workspace)
                  const title = String(workspace.title || workspacePath || '未命名工作区')
                  const sessionCount = Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0
                  return h('div', {
                    key: workspace.workspaceId || workspacePath,
                    style: {
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: 12,
                      alignItems: 'center',
                      padding: '10px 12px',
                      border: '1px solid var(--dsw-alias-separator, rgba(127,127,127,.2))',
                      borderRadius: 8,
                      background: current ? 'var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04))' : 'transparent',
                    },
                  },
                    h('div', { style: { display: 'grid', gap: 3, minWidth: 0 } },
                      h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flexWrap: 'wrap' } },
                        h('span', {
                          style: {
                            fontSize: 13,
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            maxWidth: '100%',
                          },
                        }, title),
                        current ? h('span', { style: { padding: '1px 6px', borderRadius: 999, fontSize: 10, background: 'rgba(100,150,220,.18)', color: 'var(--dsw-alias-label-secondary)' } }, '当前会话') : null,
                        enabled ? h('span', { style: { padding: '1px 6px', borderRadius: 999, fontSize: 10, background: 'rgba(90,180,120,.18)', color: '#7bd39a' } }, '已启用') : null,
                      ),
                      h('code', {
                        title: workspacePath,
                        style: { fontSize: 11, wordBreak: 'break-all', color: 'var(--dsw-alias-label-secondary)' },
                      }, workspacePath || '（无路径）'),
                      h('span', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } }, `${sessionCount} 个会话`),
                    ),
                    h('button', {
                      type: 'button',
                      disabled: !workspacePath || Boolean(busyPath),
                      onClick: () => togglePath(workspacePath),
                      style: {
                        border: '1px solid var(--dsw-alias-separator, rgba(127,127,127,.3))',
                        borderRadius: 7,
                        padding: '5px 12px',
                        background: 'transparent',
                        color: 'inherit',
                        cursor: !workspacePath || busyPath ? 'default' : 'pointer',
                        opacity: !workspacePath || busyPath ? 0.55 : 1,
                        fontSize: 12,
                      },
                    }, enabled ? '停用' : '启用'),
                  )
                }),
              ),
          h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '每个工作区独立启用；下方心情与记忆为当前会话的详情。'),
        ),

        h('section', {
          style: {
            display: 'grid',
            gap: 12,
            padding: '16px',
            border: '1px solid var(--dsw-alias-separator, rgba(127,127,127,.22))',
            borderRadius: 10,
          },
        },
          h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
            h('h2', { style: { margin: 0, fontSize: 15 } }, '当前心情'),
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
              h('span', { style: { fontSize: 30, fontWeight: 650, lineHeight: 1 } }, moodValue === null ? '—' : String(moodValue)),
              h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, '/ 100'),
            ),
          ),
          h('div', { style: { display: 'grid', gap: 7 } },
            DIMS.map(([key, label]) => h(StatBar, { key, label, value: mood.dims?.[key] || 0 })),
          ),
          mood.lastReason ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, mood.lastReason) : null,
        ),

        h('section', { style: { display: 'grid', gap: 10 } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' } },
            h('h2', { style: { margin: 0, fontSize: 15 } }, '鱼的记忆'),
            h('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, `${memory.length} 条`),
          ),
          memory.length === 0
            ? h('div', {
                style: {
                  padding: '18px 16px',
                  borderRadius: 10,
                  border: '1px dashed var(--dsw-alias-separator, rgba(127,127,127,.25))',
                  color: 'var(--dsw-alias-label-secondary)',
                  fontSize: 12,
                },
              }, data.whitelisted ? '这个会话还没有记忆条目。' : '启用这个工作区后，才会开始记录/召回记忆。')
            : h('div', { style: { display: 'grid', gap: 8 } },
                memory.map((item, index) => h('article', {
                  key: `${index}:${item.at || ''}`,
                  style: {
                    padding: '10px 12px',
                    border: '1px solid var(--dsw-alias-separator, rgba(127,127,127,.2))',
                    borderRadius: 8,
                    display: 'grid',
                    gap: 4,
                  },
                },
                  h('div', { style: { fontSize: 13, lineHeight: 1.5, wordBreak: 'break-word' } }, item.text || '（空）'),
                  h('div', { style: { fontSize: 10, color: 'var(--dsw-alias-label-secondary)' } }, `重要度 ${Number(item.importance || 0).toFixed(2)}`),
                )),
              ),
        ),

        error ? h('div', { style: { fontSize: 12, color: '#d98b8b' } }, error) : null,
      )
    }

    return {
      inject: ['layout', 'slots', 'uiWorkspace'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 50,
          label: () => '鱼记忆 / 心情',
        }, Icon))

        const Page = (props) => h(PanelPage, {
          ...props,
          onBack: () => ctx.layout.selectPanel(null),
          onOpenSession: (session) => ctx.uiWorkspace.openSession(session),
        })

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Page))
      },
    }
  },
})
