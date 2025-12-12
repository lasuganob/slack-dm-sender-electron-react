import { MultiSelect } from "@mantine/core";
import React from "react";
import type { SlackUser } from "../global";

interface UserSelectProps {
  users: SlackUser[];
  selectedUserIds: string[];
  setSelectedUserIds: (ids: string[]) => void;
  busy: boolean;
}

const UserSelect: React.FC<UserSelectProps> = ({
  users,
  selectedUserIds,
  setSelectedUserIds,
  busy,
}) => {
  const userOptions = users.map((u) => ({
    value: u.id,
    label: `${u.slackName || u.glatsName}`,
  }));

  return (
    <MultiSelect
      placeholder="Select users..."
      data={userOptions}
      searchable
      value={selectedUserIds}
      onChange={setSelectedUserIds}
      nothingFoundMessage={busy ? "Loading users…" : "No users found"}
      disabled={busy}
      width="100%"
    />
  );
};

export default UserSelect;
