import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import type React from 'react'
import { useState } from 'react'

export interface ChatInputPaneProps {
  onSubmit: (text: string) => void
  disabled?: boolean
}

import { isRecentWheelEvent } from './App.js'

export const ChatInputPane: React.FC<ChatInputPaneProps> = ({ onSubmit, disabled = false }) => {
  const [value, setValue] = useState('')
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null)

  const handleChange = (text: string) => {
    // Strip ANSI and SGR mouse tracking escape sequences
    // biome-ignore lint/complexity/useRegexLiterals: RegExp constructor required to avoid noControlCharactersInRegex on \x1b
    const sgrPattern = new RegExp('\\x1b\\[<[0-9]+;[0-9]+;[0-9]+[Mm]', 'g')
    // biome-ignore lint/complexity/useRegexLiterals: RegExp constructor required to avoid noControlCharactersInRegex on \x1b
    const ansiPattern = new RegExp('\\x1b\\[[0-9;]*[a-zA-Z]', 'g')
    let sanitized = text
      .replace(sgrPattern, '')
      .replace(/<[0-9]+;[0-9]+;[0-9]+[Mm]/g, '')
      .replace(/\[<[0-9]+;[0-9]+;[0-9]+[Mm]/g, '')
      .replace(ansiPattern, '')

    // If mouse was scrolled within the last 600ms, strip any newly appended '[' artifact
    if (isRecentWheelEvent(600) && sanitized.endsWith('[')) {
      sanitized = sanitized.replace(/\[+$/g, '')
    }

    setValue(sanitized)
  }

  const handleSubmit = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || disabled) return
    onSubmit(trimmed)
    setLastSubmitted(trimmed)
    setValue('')
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
      {lastSubmitted ? (
        <Box>
          <Text dimColor wrap="wrap">
            Last sent: {lastSubmitted}
          </Text>
        </Box>
      ) : null}
      <Box flexDirection="row">
        <Text bold color="cyan">
          etemaro &gt;{' '}
        </Text>
        {disabled ? (
          <Text dimColor>(Connecting... chat disabled)</Text>
        ) : (
          <TextInput
            value={value}
            onChange={handleChange}
            onSubmit={handleSubmit}
            placeholder="Type command (/status, /screen, /help) or chat prompt..."
          />
        )}
      </Box>
    </Box>
  )
}
