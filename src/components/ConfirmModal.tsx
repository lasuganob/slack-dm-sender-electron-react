import React from "react";
import {
  Paper,
  Stack,
  Group,
  Text,
  Button,
  Badge,
  Textarea,
} from "@mantine/core";
import { IconSend } from "@tabler/icons-react";
import type { SlackUser } from "../global";

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onSend: () => void;
  selectedUsers: SlackUser[];
  message: string;
  attachmentsDir: string | null;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  onClose,
  onSend,
  selectedUsers,
  message,
  attachmentsDir,
}) => {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <Paper
        shadow="xl"
        radius="md"
        p="md"
        style={{
          width: "min(600px, 90vw)",
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <Stack>
          <Text fw={600} size="lg">
            Confirm send
          </Text>
          <div>
            <Text fw={500} mb={4}>
              Recipients ({selectedUsers.length})
            </Text>
            <Group gap="xs">
              {selectedUsers.map((u) => (
                <Badge size="sm" key={u.id}>
                  {u.glatsName}{" "}
                </Badge>
              ))}
            </Group>
          </div>
          <div>
            <Text fw={500} mb={4}>
              Message
            </Text>
            <Textarea minRows={4} autosize readOnly value={message} />
          </div>
          <Group justify="flex-end" mt="md">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button leftSection={<IconSend size={16} />} onClick={onSend}>
              Confirm &amp; Send
            </Button>
          </Group>
          <Text size="sm" c="dimmed">
            {attachmentsDir
              ? `Attachments Directory: ${attachmentsDir}`
              : "No attachments directory selected."}
          </Text>
        </Stack>
      </Paper>
    </div>
  );
};

export default ConfirmModal;
