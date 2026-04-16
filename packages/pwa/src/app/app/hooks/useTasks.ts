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
  task_participants?: TaskParticipant[];
  task_conversations?: TaskConversation[];
  task_messages?: TaskMessage[];
  task_comments?: { count: number }[];
}

export interface TaskParticipant {
  id: string;
  user_id: string | null;
  contact_jid: string | null;
  instance_id: string | null;
  role: string;
  added_at?: string;
}

export interface TaskConversation {
  id: string;
  instance_id: string;
  chat_jid: string;
  chat_name: string | null;
  added_at?: string;
}

export interface TaskMessage {
  id: string;
  instance_id: string;
  chat_jid: string;
  waclaw_msg_id: string;
  waclaw_session_id: string;
  snippet: string | null;
  sender_name: string | null;
  message_ts: string | null;
  added_at?: string;
}

export interface TaskComment {
  id: string;
  author_id: string;
  body: string;
  ref_waclaw_msg_id: string | null;
  ref_session_id: string | null;
  created_at: string;
  updated_at: string;
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
    updates: Partial<Pick<Task, "title" | "description" | "priority" | "status" | "assigned_to" | "due_date">>
  ) => {
    if (!session?.access_token) return null;
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(updates),
    });
    if (!res.ok) return null;
    const data = await res.json();
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...data.task } : t)));
    return data.task as Task;
  }, [session?.access_token, headers]);

  const deleteTask = useCallback(async (taskId: string) => {
    if (!session?.access_token) return;
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "DELETE",
      headers: headers(),
    });
    if (res.ok) setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, [session?.access_token, headers]);

  // Auto-load on mount
  useEffect(() => { loadTasks(); }, [loadTasks]);

  return { tasks, loading, loadTasks, createTask, updateTask, deleteTask };
}

export function useTaskDetail(taskId: string | null) {
  const { session } = useAuth();
  const [task, setTask] = useState<Task | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
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
      setComments(data.task.task_comments || []);
    }
    setLoading(false);
  }, [taskId, session?.access_token, headers]);

  const addComment = useCallback(async (body: string, refMsgId?: string, refSessionId?: string) => {
    if (!taskId || !session?.access_token) return null;
    const res = await fetch(`/api/tasks/${taskId}/comments`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        body,
        ref_waclaw_msg_id: refMsgId || null,
        ref_session_id: refSessionId || null,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    setComments((prev) => [...prev, data.comment]);
    return data.comment as TaskComment;
  }, [taskId, session?.access_token, headers]);

  const addParticipant = useCallback(async (input: {
    user_id?: string;
    contact_jid?: string;
    instance_id?: string;
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

  const addConversation = useCallback(async (input: {
    instance_id: string;
    chat_jid: string;
    chat_name?: string;
  }) => {
    if (!taskId || !session?.access_token) return;
    await fetch(`/api/tasks/${taskId}/conversations`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(input),
    });
    loadDetail();
  }, [taskId, session?.access_token, headers, loadDetail]);

  const removeConversation = useCallback(async (conversationId: string) => {
    if (!taskId || !session?.access_token) return;
    await fetch(`/api/tasks/${taskId}/conversations?conversationId=${conversationId}`, {
      method: "DELETE",
      headers: headers(),
    });
    loadDetail();
  }, [taskId, session?.access_token, headers, loadDetail]);

  const pinMessage = useCallback(async (input: {
    instance_id: string;
    chat_jid: string;
    waclaw_msg_id: string;
    waclaw_session_id: string;
    snippet?: string;
    sender_name?: string;
    message_ts?: string;
  }) => {
    if (!taskId || !session?.access_token) return;
    await fetch(`/api/tasks/${taskId}/messages`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(input),
    });
    loadDetail();
  }, [taskId, session?.access_token, headers, loadDetail]);

  const unpinMessage = useCallback(async (messageId: string) => {
    if (!taskId || !session?.access_token) return;
    await fetch(`/api/tasks/${taskId}/messages?messageId=${messageId}`, {
      method: "DELETE",
      headers: headers(),
    });
    loadDetail();
  }, [taskId, session?.access_token, headers, loadDetail]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  // Poll comments every 5s when task is open
  useEffect(() => {
    if (!taskId || !session?.access_token) return;
    const id = setInterval(async () => {
      const res = await fetch(`/api/tasks/${taskId}/comments`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [taskId, session?.access_token, headers]);

  return {
    task, comments, loading, loadDetail,
    addComment, addParticipant, removeParticipant,
    addConversation, removeConversation,
    pinMessage, unpinMessage,
  };
}
