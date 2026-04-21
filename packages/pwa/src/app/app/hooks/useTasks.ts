"use client";

import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/lib/use-auth";

export interface Task {
  id: string;
  creator_id: string;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  status: "open" | "in_progress" | "resolved" | "closed";
  assigned_to: string | null;
  due_date: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  // WA group backing
  wa_group_jid?: string | null;
  wa_instance_id?: string | null;
  wa_group_created_at?: string | null;
  task_participants?: TaskParticipant[];
}

export interface TaskParticipant {
  id: string;
  user_id: string | null;
  contact_jid: string | null;
  instance_id: string | null;
  role: string;
  joined_group_at?: string | null;
  join_failure?: string | null;
  added_at?: string;
}

export function useTasks() {
  const { session } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token}`,
  }), [session?.access_token]);

  const loadTasks = useCallback(async (filters?: { status?: string; priority?: string }) => {
    if (!session?.access_token) return;
    setLoading(true);
    const params = new URLSearchParams();
    if (filters?.status) params.set("status", filters.status);
    if (filters?.priority) params.set("priority", filters.priority);
    const qs = params.toString();
    const res = await fetch(`/api/tasks${qs ? `?${qs}` : ""}`, { headers: headers() });
    if (res.ok) {
      const data = await res.json();
      setTasks(data.tasks || []);
    }
    setLoading(false);
  }, [session?.access_token, headers]);

  const createTask = useCallback(async (input: {
    title: string;
    description?: string;
    priority?: string;
    due_date?: string;
    instance_id?: string;
    participants?: { contact_jid: string; contact_name?: string }[];
  }) => {
    if (!session?.access_token) return null;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const data = await res.json();
    setTasks((prev) => [data.task, ...prev]);
    return data.task as Task;
  }, [session?.access_token, headers]);

  const updateTask = useCallback(async (
    taskId: string,
    updates: Partial<Pick<Task, "title" | "description" | "priority" | "status" | "assigned_to" | "due_date">>,
  ) => {
    if (!session?.access_token) return null;
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) return null;
    const data = await res.json();
    setTasks((prev) => prev.map((t) => (t.id === taskId ? data.task : t)));
    return data.task as Task;
  }, [session?.access_token, headers]);

  const deleteTask = useCallback(async (taskId: string) => {
    if (!session?.access_token) return false;
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (!res.ok) return false;
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
    return true;
  }, [session?.access_token, headers]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  return { tasks, loading, loadTasks, createTask, updateTask, deleteTask };
}

export function useTaskDetail(taskId: string | null) {
  const { session } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);

  const headers = useCallback(() => ({
    "Content-Type": "application/json",
    Authorization: `Bearer ${session?.access_token}`,
  }), [session?.access_token]);

  const loadDetail = useCallback(async () => {
    if (!taskId || !session?.access_token) return;
    setLoading(true);
    const res = await fetch(`/api/tasks/${taskId}`, { headers: headers() });
    if (res.ok) {
      const data = await res.json();
      setTask(data.task);
    }
    setLoading(false);
  }, [taskId, session?.access_token, headers]);

  const addParticipant = useCallback(async (input: {
    user_id?: string;
    contact_jid?: string;
    contact_name?: string;
    role?: string;
  }) => {
    if (!taskId || !session?.access_token) return;
    await fetch(`/api/tasks/${taskId}/participants`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(input),
    });
    loadDetail();
  }, [taskId, session?.access_token, headers, loadDetail]);

  const removeParticipant = useCallback(async (participantId: string) => {
    if (!taskId || !session?.access_token) return;
    await fetch(`/api/tasks/${taskId}/participants?participantId=${participantId}`, {
      method: "DELETE",
      headers: headers(),
    });
    loadDetail();
  }, [taskId, session?.access_token, headers, loadDetail]);

  // Send a direct message to a single participant (bypasses the group).
  const sendDirectMessage = useCallback(async (contactJid: string, body: string) => {
    if (!taskId || !session?.access_token) return false;
    const res = await fetch(`/api/tasks/${taskId}/dm`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ contact_jid: contactJid, body }),
    });
    return res.ok;
  }, [taskId, session?.access_token, headers]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  return {
    task, loading, loadDetail,
    addParticipant, removeParticipant, sendDirectMessage,
  };
}
