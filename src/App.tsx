import {
  Anchor,
  Button,
  Container,
  Divider,
  Group,
  MantineProvider,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { IconRefresh, IconSend } from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import ConfirmModal from "./components/ConfirmModal";
import LoadingOverlay from "./components/LoadingOverlay";
import MessageEditor from "./components/MessageEditor";
import UserSelect from "./components/UserSelect";

import type { SendDmsResult, SlackUser, SyncUsersResult } from "./global";

const App: React.FC = () => {
  const [users, setUsers] = useState<SlackUser[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [attachmentsDir, setAttachmentsDir] = useState<string | null>(null);

  const [loadingUsers, setLoadingUsers] = useState(true);
  const [syncingUsers, setSyncingUsers] = useState(false);
  const [sending, setSending] = useState(false);

  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const busySync = loadingUsers || syncingUsers;
  const busyAll = busySync || sending;

  const handleSyncResult = (result: SyncUsersResult) => {
    if (result.ok) {
      setUsers(result.users);
      return;
    }

    if (result.rateLimited) {
      const retrySec = result.retryAfter ?? 30;
      setRateLimitMessage(
        `Slack rate limit reached for users list. Please wait about ${retrySec} seconds before refreshing again.`
      );
      alert(
        `Slack rate limit reached for users.list.\n\nPlease wait about ${retrySec} seconds before trying again.\n\nDetails have been logged.`
      );
    } else {
      alert(`Failed to sync users: ${result.error}`);
    }
  };

  useEffect(() => {
    const init = async () => {
      setLoadingUsers(true);
      try {
        const result: SyncUsersResult = await window.api.syncUsers();
        handleSyncResult(result);
      } catch (e: unknown) {
        let msg = "";
        if (e instanceof Error) {
          msg = e.message;
        } else {
          msg = e ? String(e) : "Unknown error";
        }
        alert(`Unexpected error syncing users: ${msg}`);
      } finally {
        setLoadingUsers(false);
      }
    };
    init();

    window.api.onUsersUpdated(({ users }) => {
      setUsers(users);
    });
  }, []);

  const handleChooseAttachmentsDir = async () => {
    const dir = await window.api.chooseAttachmentsDir();
    if (dir) setAttachmentsDir(dir);
  };

  const selectedUsers = users.filter((u) => selectedUserIds.includes(u.id));

  const formatSelection = (options: { before: string; after?: string }) => {
    const el = textareaRef.current;
    if (!el || busyAll) return;

    const { before, after = before } = options;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const current = message;

    if (start === end) {
      const placeholder = "text";
      const updated =
        current.slice(0, start) +
        before +
        placeholder +
        after +
        current.slice(end);
      setMessage(updated);
      const cursorPos = start + before.length;
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(cursorPos, cursorPos + placeholder.length);
      });
      return;
    }

    const selectedText = current.slice(start, end);
    const wrapped = before + selectedText + after;
    const updated = current.slice(0, start) + wrapped + current.slice(end);
    setMessage(updated);
    requestAnimationFrame(() => {
      el.focus();
      const newStart = start + before.length;
      const newEnd = newStart + selectedText.length;
      el.setSelectionRange(newStart, newEnd);
    });
  };

  // ---------- Actions ----------
  const handleOpenConfirm = () => {
    if (busyAll) return;
    if (!selectedUserIds.length) {
      alert("Please select at least one recipient.");
      return;
    }
    if (!message.trim()) {
      alert("Please enter a message.");
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
        message,
        attachmentsDir
      );

      if (res.ok) {
        alert(`Message successfully sent to ${res.sent} recipient(s).`);
      } else {
        const failedList = res.failedUsers
          .slice(0, 5)
          .map((f) => `${f.userId}: ${f.error}`)
          .join("\n");
        alert(
          [
            `Some messages failed to send.`,
            `Sent: ${res.sent}, Failed: ${res.failed}`,
            failedList ? `Examples:\n${failedList}` : "",
          ]
            .filter(Boolean)
            .join("\n\n")
        );
      }
    } catch (e: unknown) {
      let msg = "";
      if (e instanceof Error) {
        msg = e.message;
      } else {
        msg = e ? String(e) : "Unknown error";
      }
      alert(`Unexpected error while sending messages: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  const handleOpenCsv = async () => {
    try {
      await window.api.openCsv();
    } catch (e: unknown) {
      if (e instanceof Error) {
        alert(
          `Failed to open slack_users.csv: ${e.message}\n\nPlease open it manually from the app folder if needed.`
        );
        return;
      }
      return alert("Failed to open slack_users.csv for unknown reason.");
    }
  };

  const handleReloadUsersFromCsv = async () => {
    setSyncingUsers(true);
    try {
      const result: SyncUsersResult = await window.api.reloadUsersFromCsv();
      handleSyncResult(result);
    } catch (e: unknown) {
      let msg = "";
      if (e instanceof Error) {
        msg = e.message;
      } else {
        msg = e ? String(e) : "Unknown error";
      }
      alert(`Unexpected error reloading users from CSV: ${msg}`);
    } finally {
      setSyncingUsers(false);
    }
  };

  // ---------- Render ----------
  return (
    <MantineProvider>
      <Container>
        <Group justify="space-between" mb="md">
          <>
            <Title order={2}>Slack DM Sender</Title>
            <Text size="xs" c="red" mt={4}>
              {rateLimitMessage}
            </Text>
          </>
          <Button
              size="xs"
              variant="light"
              leftSection={<IconRefresh size={14} />}
              onClick={handleReloadUsersFromCsv}
              loading={syncingUsers}
              disabled={sending || busyAll}
            >
              Refresh Users
          </Button>
        </Group>
        <Stack gap="md">
          <UserSelect
            users={users}
            selectedUserIds={selectedUserIds}
            setSelectedUserIds={setSelectedUserIds}
            busy={busyAll}
          />
          <Divider size="sm" />
          <MessageEditor
            message={message}
            setMessage={setMessage}
            busy={sending}
            textareaRef={textareaRef}
            wrapSelection={(wrapper) =>
              formatSelection({ before: wrapper, after: wrapper })
            }
          />
          <Paper withBorder p="sm">
            <Group justify="space-between" align="flex-start">
              <div>
                <Text fw={500}>
                  Attachment folder <small>(Optional)</small>
                </Text>
                <Text size="xs" c="dimmed">
                  Each selected user must have a PDF named after their Glats
                  Name. <Anchor onClick={handleOpenCsv}>Show List</Anchor>
                </Text>
                <Text size="xs" mt={6}>
                  Current folder: <i>{attachmentsDir ?? "None selected"}</i>
                </Text>
              </div>
              <Button
                size="xs"
                variant="light"
                onClick={handleChooseAttachmentsDir}
                disabled={busyAll}
              >
                Choose folder…
              </Button>
            </Group>
          </Paper>
          <Group justify="flex-end" mt="md">
            <Button
              leftSection={<IconSend size={16} />}
              onClick={handleOpenConfirm}
              disabled={busyAll}
            >
              Send
            </Button>
          </Group>
        </Stack>
        <ConfirmModal
          open={confirmOpen}
          onClose={() => setConfirmOpen(false)}
          onSend={handleSend}
          selectedUsers={selectedUsers}
          message={message}
          attachmentsDir={attachmentsDir}
        />
        <LoadingOverlay
          show={sending || busyAll}
          type={sending ? "send" : "sync"}
        />
      </Container>
    </MantineProvider>
  );
};

export default App;
