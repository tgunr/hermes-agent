import { Box, Text, useInput, useStdout } from '@hermes/ink'
import { useEffect, useMemo, useState } from 'react'

import { sessionCwd } from '../app/uiStore.js'
import { moveSessionInto, projectRows } from '../domain/projects.js'
import type { GatewayClient } from '../gatewayClient.js'
import { useT } from '../i18n/useT.js'
import { rpcErrorMessage } from '../lib/rpc.js'
import type { Theme } from '../theme.js'
import type { ProjectInfo } from '../types.js'

import { OverlayHint, windowItems } from './overlayControls.js'
import { chipRowProps, clampOverlayWidth } from './overlayPrimitives.js'

const VISIBLE = 10
const MIN_WIDTH = 40
const MAX_WIDTH = 90

interface ProjectsListResponse {
  active_id?: null | string
  projects?: ProjectInfo[]
}

/**
 * Interactive Projects picker: the `/projects` pop-up. Lists this profile's Projects (active one
 * first, the folder this session sits in marked), filters as you type, and Enter moves the live
 * session into the highlighted folder with `session.workspace.move` (-> `session.cwd.set`). Rows
 * re-read after a move so the markers follow the session.
 */
export function ProjectsPicker({ gw, maxWidth, onClose, sid, t }: ProjectsPickerProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [activeId, setActiveId] = useState<null | string>(null)
  const [cwd, setCwd] = useState(sessionCwd() ?? '')
  const [query, setQuery] = useState('')
  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const T = useT()
  const P = T.pickers.projects
  const C = T.pickers.common

  const { stdout } = useStdout()
  const preferredWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, (stdout?.columns ?? 80) - 6))
  const width = clampOverlayWidth(preferredWidth, maxWidth)

  const load = () => {
    gw.request<ProjectsListResponse>('projects.list', {})
      .then(r => {
        setProjects(r?.projects ?? [])
        setActiveId(r?.active_id ?? null)
        setErr('')
      })
      .catch((e: unknown) => setErr(rpcErrorMessage(e)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [gw])

  // The session's folder decides the `here` marker; a successful move updates it locally.
  useEffect(() => setCwd(sessionCwd() ?? ''), [])

  const view = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = projectRows(projects, activeId, cwd)

    return needle
      ? rows.filter(row => row.project.name.toLowerCase().includes(needle) || row.project.slug.includes(needle))
      : rows
  }, [projects, activeId, cwd, query])

  const move = (project: ProjectInfo) => {
    if (!sid) {
      return setErr(P.noSession)
    }

    setBusy(true)
    setNote('')
    setErr('')

    moveSessionInto(gw, project, sid)
      .then(where => {
        setCwd(where)
        setNote(P.moved(project.name, where))
        load()
      })
      .catch((e: unknown) => setErr(rpcErrorMessage(e)))
      .finally(() => setBusy(false))
  }

  useInput((input, key) => {
    if (busy) {
      return
    }

    if (key.escape) {
      return onClose()
    }

    if (key.upArrow) {
      return setIdx(i => Math.max(0, i - 1))
    }

    if (key.downArrow) {
      return setIdx(i => Math.min(view.length - 1, i + 1))
    }

    if (key.return) {
      const row = view[idx]

      return row ? move(row.project) : undefined
    }

    if (key.backspace || key.delete) {
      setQuery(q => q.slice(0, -1))

      return setIdx(0)
    }

    if (input && input.length === 1 && input >= ' ' && !key.ctrl && !key.meta) {
      setQuery(q => q + input)
      setIdx(0)
    }
  })

  if (loading) {
    return <Text color={t.color.muted}>{P.loading}</Text>
  }

  if (err && !projects.length) {
    return (
      <Box flexDirection="column" width={width}>
        <Text color={t.color.label}>{C.error(err)}</Text>
        <OverlayHint t={t}>{P.escCancelHint}</OverlayHint>
      </Box>
    )
  }

  const { items, offset } = windowItems(view, idx, VISIBLE)

  return (
    <Box flexDirection="column" width={width}>
      <Text bold color={t.color.accent}>
        {P.title}
      </Text>

      <Text color={t.color.muted} wrap="truncate-end">
        {query ? C.filter(query) : C.typeToFilter} · {view.length === 1 ? P.countOne : P.countOther(view.length)}
      </Text>

      {offset > 0 && <Text color={t.color.muted}>{C.moreAbove(offset)}</Text>}

      {view.length === 0 ? (
        <Text color={t.color.muted}>{query ? P.noMatches(query) : P.none}</Text>
      ) : (
        items.map((row, i) => {
          const at = offset + i === idx

          return (
            <Text color={t.color.muted} {...chipRowProps(t, at)} key={row.project.id} wrap="truncate-end">
              {at ? '▸ ' : '  '}
              {row.active ? '●' : ' '} {row.project.name}
              <Text color={at ? t.color.accent : t.color.muted}>
                {' '}
                {row.path || P.noFolder}
                {row.here ? ' ← here' : ''}
              </Text>
            </Text>
          )
        })
      )}

      {offset + VISIBLE < view.length && (
        <Text color={t.color.muted}>{C.moreBelow(view.length - offset - VISIBLE)}</Text>
      )}

      {note ? <Text color={t.color.accent}>{note}</Text> : null}
      {err ? <Text color={t.color.label}>{C.error(err)}</Text> : null}
      {busy ? <Text color={t.color.accent}>{P.moving}</Text> : null}

      <OverlayHint t={t}>{P.hint}</OverlayHint>
    </Box>
  )
}

interface ProjectsPickerProps {
  gw: GatewayClient
  maxWidth?: number
  onClose: () => void
  sid: null | string
  t: Theme
}
