import React, { useEffect, useState, useRef } from 'react';
import {
  MantineProvider,
  Container,
  Title,
  Text,
  MultiSelect,
  Textarea,
  Button,
  Group,
  Stack,
  Badge,
  Paper,
  Loader
} from '@mantine/core';
import { IconSend, IconRefresh } from '@tabler/icons-react';
import type {
  SlackUser,
  SyncUsersResult,
  SendDmsResult,
} from './global';

const App: React.FC = () => {
  const [users, setUsers] = useState<SlackUser[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [csvPath, setCsvPath] = useState<string | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);

  const [loadingUsers, setLoadingUsers] = useState(true);
  const [syncingUsers, setSyncingUsers] = useState(false);
  const [sending, setSending] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const busySync = loadingUsers || syncingUsers;
  const busyAll = busySync || sending;

  // Initial sync
  useEffect(() => {
    const init = async () => {
      setLoadingUsers(true);
      try {
        const result: SyncUsersResult = await window.api.syncUsers();
        if (result.ok) {
          setUsers(result.users);
          setCsvPath(result.csvPath);
          setLogPath(result.logPath);
        } else {
          setLogPath(result.logPath);
          alert(`Failed to sync users: ${result.error}`);
        }
      } catch (e: unknown) {
        let errorMsg = 'Unexpected error syncing users.';
        if (e instanceof Error) {
          errorMsg = e.message;
        } else if (typeof e === 'string') {
          errorMsg = e;
        }
        alert(`Unexpected error syncing users: ${errorMsg}`);
      } finally {
        setLoadingUsers(false);
      }
    };
    init();

    window.api.onUsersUpdated(({ users, csvPath }) => {
      setUsers(users);
      setCsvPath(csvPath);
    });

    window.api.getLogPath().then((lp) => lp && setLogPath(lp));
  }, []);

  const handleRefreshUsers = async () => {
    setSyncingUsers(true);
    try {
      const result: SyncUsersResult = await window.api.syncUsers();
      if (result.ok) {
        setUsers(result.users);
        setCsvPath(result.csvPath);
        setLogPath(result.logPath);
      } else {
        setLogPath(result.logPath);
        alert(`Failed to sync users: ${result.error}`);
      }
    } catch (e: unknown) {
      let errorMsg = 'Unexpected error syncing users.';
      if (e instanceof Error) {
        errorMsg = e.message;
      } else if (typeof e === 'string') {
        errorMsg = e;
      }
      alert(`Unexpected error syncing users: ${errorMsg}`);
    } finally {
      setSyncingUsers(false);
    }
  };

  const userOptions = users.map((u) => ({
    value: u.id,
    label: `${u.displayName || u.realName || u.name}`,
  }));

  const selectedUsers = users.filter((u) => selectedUserIds.includes(u.id));

  const wrapSelection = (wrapper: '*' | '_') => {
    const el = textareaRef.current;
    if (!el || busyAll) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const current = message;

    if (start === end) {
      const updated =
        current.slice(0, start) + wrapper + wrapper + current.slice(end);
      setMessage(updated);
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(start + 1, start + 1);
      });
    } else {
      const selectedText = current.slice(start, end);
      const updated =
        current.slice(0, start) +
        wrapper +
        selectedText +
        wrapper +
        current.slice(end);
      setMessage(updated);
      requestAnimationFrame(() => {
        el.focus();
        const pos =
          start + wrapper.length + selectedText.length + wrapper.length;
        el.setSelectionRange(pos, pos);
      });
    }
  };

  const handleOpenConfirm = () => {
    if (busyAll) return;
    if (!selectedUserIds.length) {
      alert('Please select at least one recipient.');
      return;
    }
    if (!message.trim()) {
      alert('Please enter a message.');
      return;
    }

    setConfirmOpen(true);
  };

  const handleSend = async () => {
    setConfirmOpen(false);
    setSending(true);

    try {
      const res: SendDmsResult = await window.api.sendDms(
        selectedUserIds,
        message
      );

      if (res.ok) {
        alert(`Message successfully sent to ${res.sent} recipient(s).`);
      } else {
        const failedList = res.failedUsers
          .slice(0, 5)
          .map((f) => `${f.userId}: ${f.error}`)
          .join('\n');
        alert(
          [
            `Some messages failed to send.`,
            `Sent: ${res.sent}, Failed: ${res.failed}`,
            failedList ? `Examples:\n${failedList}` : '',
            logPath ? `\nSee log file for details:\n${logPath}` : '',
          ]
            .filter(Boolean)
            .join('\n\n')
        );
      }
    } catch (e: unknown) {
      let errorMsg = 'Unexpected error while sending messages.';
      if (e instanceof Error) {
        errorMsg = e.message;
      } else if (typeof e === 'string') {
        errorMsg = e;
      }
      alert(
        `${errorMsg}${logPath ? `\n\nCheck the log file:\n${logPath}` : ''}`
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <MantineProvider>
      <Container size="md" py="md">
        <Title order={2}>Glats Ops Tool - Slack DM</Title>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          onClick={handleRefreshUsers}
          loading={syncingUsers}
          disabled={sending}
          mb="sm"
        >
          Refresh users from Slack
        </Button>

        <Stack gap="md">
          <MultiSelect
            label="Recipients"
            placeholder="Select Slack users"
            data={userOptions}
            searchable
            value={selectedUserIds}
            onChange={setSelectedUserIds}
            nothingFoundMessage={
              busySync ? 'Loading users…' : 'No users found'
            }
            disabled={busyAll}
          />

          <Text size="sm">Message:</Text>
          <Group gap="xs">
            <Button
              size="xs"
              variant="light"
              onClick={() => wrapSelection('*')}
              disabled={busyAll}
            >
              Bold
            </Button>
            <Button
              size="xs"
              variant="light"
              onClick={() => wrapSelection('_')}
              disabled={busyAll}
            >
              Italic
            </Button>
          </Group>

          <Textarea
            ref={textareaRef}
            placeholder="Type your message here..."
            minRows={6}
            autosize
            value={message}
            onChange={(e) => setMessage(e.currentTarget.value)}
            disabled={busyAll}
          />
          <Button
            leftSection={<IconSend size={16} />}
            onClick={handleOpenConfirm}
            disabled={busyAll}
          >
            Send
          </Button>
        </Stack>

        {confirmOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 2000,
            }}
          >
            <Paper
              shadow="xl"
              radius="md"
              p="md"
              style={{ width: 'min(600px, 90vw)', maxHeight: '80vh', overflowY: 'auto' }}
            >
              <Stack>
                <Group justify="space-between">
                  <Text fw={600} size="lg">
                    Confirm send
                  </Text>
                  <Button
                    variant="subtle"
                    size="xs"
                    onClick={() => setConfirmOpen(false)}
                  >
                    Close
                  </Button>
                </Group>

                <div>
                  <Text fw={500} mb={4}>
                    Recipients ({selectedUsers.length})
                  </Text>
                  <Group gap="xs">
                    {selectedUsers.map((u) => (
                      <Badge size="sm">
                        {u.displayName || u.realName || u.name}{' '}
                      </Badge>
                    ))}
                  </Group>
                </div>

                <div>
                  <Text fw={500} mb={4}>
                    Message
                  </Text>
                  <Textarea
                    minRows={4}
                    autosize
                    readOnly
                    value={message}
                  />
                </div>

                <Group justify="flex-end" mt="md">
                  <Button
                    variant="default"
                    onClick={() => setConfirmOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    leftSection={<IconSend size={16} />}
                    onClick={handleSend}
                  >
                    Confirm &amp; Send
                  </Button>
                </Group>
              </Stack>
            </Paper>
          </div>
        )}

        {sending && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0, 0, 0, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 3000,
            }}
          >
            <Paper
              shadow="xl"
              radius="md"
              p="md"
              style={{ width: 'min(320px, 90vw)', textAlign: 'center' }}
            >
              <Stack align="center" gap="sm">
                <Loader />
                <Text size="sm">
                  Sending Slack DMs… Please wait until the process finishes.
                </Text>
              </Stack>
            </Paper>
          </div>
        )}
        <Stack mt="md" mb="xs" gap={4} align="flex-start">
          {csvPath && (
            <Text size="xs">
              <b>Users CSV:</b> <code>{csvPath}</code>
            </Text>
          )}
          {logPath && (
            <Text size="xs">
              <b>Log file:</b> <code>{logPath}</code>
            </Text>
          )}
        </Stack>
      </Container>
    </MantineProvider>
  );
};

export default App;
