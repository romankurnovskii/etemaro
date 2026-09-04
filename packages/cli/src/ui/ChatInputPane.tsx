import { Box, Text } from 'ink'
import TextInput from 'ink-text-input'
import type React from 'react'
import { useState } from 'react'

export interface ChatInputPaneProps {
  onSubmit: (text: string) => void
  disabled?: boolean
}

export const ChatInputPane: React.FC<ChatInputPaneProps> = ({ onSubmit, disabled = false }) => {
  const [value, setValue] = useState('')
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null)

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
          <Text dimColor>Last sent: {lastSubmitted.slice(0, 80)}</Text>
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
            onChange={setValue}
            onSubmit={handleSubmit}
            placeholder="Type command (/status, /screen, /help) or chat prompt..."
          />
        )}
      </Box>
    </Box>
  )
}
