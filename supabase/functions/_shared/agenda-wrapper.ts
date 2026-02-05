/**
 * Agenda Management Wrappers
 * 
 * Provides two implementations:
 * 1. SharedAgendaManager - calls centralized agenda-manager edge function (persistent)
 * 2. AgendaManager - in-memory fallback for when thread ID is not available
 */

/**
 * Shared Agenda Manager - calls the centralized agenda-manager edge function
 * Provides cross-interface persistence for call agendas
 */
export class SharedAgendaManager {
  private threadId: string | null = null;
  private userId: string | null = null;
  private supabaseUrl: string;
  private supabaseServiceKey: string;
  private cachedStatus: {
    items: any[];
    completed: number;
    total: number;
    currentItem: any | null;
    isPaused: boolean;
  } | null = null;

  constructor(
    threadId: string | null, 
    userId: string | null,
    supabaseUrl: string,
    supabaseServiceKey: string
  ) {
    this.threadId = threadId;
    this.userId = userId;
    this.supabaseUrl = supabaseUrl;
    this.supabaseServiceKey = supabaseServiceKey;
  }

  private async callService(operation: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!this.threadId || !this.userId) {
      console.log(`[SHARED-AGENDA] Skipping ${operation} - no thread/user`);
      return null;
    }
    
    try {
      const response = await fetch(`${this.supabaseUrl}/functions/v1/agenda-manager`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.supabaseServiceKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operation,
          threadId: this.threadId,
          userId: this.userId,
          ...params
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log(`[SHARED-AGENDA] ${operation} succeeded`);
        return result;
      } else {
        console.error(`[SHARED-AGENDA] ${operation} failed: ${response.status}`);
        return null;
      }
    } catch (error) {
      console.error(`[SHARED-AGENDA] ${operation} error:`, error);
      return null;
    }
  }

  async initialize(context: string, agenda?: any[], source: string = 'scheduled_call') {
    // If legacy agenda array is provided, convert to context format
    let contextToUse = context;
    if (agenda && agenda.length > 0) {
      const agendaText = agenda.map((item, idx) => `${idx + 1}. ${item.text}`).join('\n');
      contextToUse = context + '\n\nAGENDA:\n' + agendaText;
    }
    
    const result = await this.callService('initialize', { context: contextToUse, source });
    if (result?.itemCount > 0) {
      // Auto-start first item
      await this.startItem(0);
    }
    return result;
  }

  async startItem(index: number) {
    return this.callService('start_item', { itemIndex: index });
  }

  async completeCurrentItem() {
    return this.callService('complete_item', { autoAdvance: true });
  }

  async pauseForQuery(userQuery: string) {
    return this.callService('pause_for_tangent', { userQuery });
  }

  async resume() {
    return this.callService('resume');
  }

  async getResumeHint(): Promise<string | null> {
    const result = await this.callService('get_resume_hint');
    return result?.hint || null;
  }

  async getStatus() {
    const status = await this.callService('get_status');
    if (status) {
      this.cachedStatus = status;
    }
    return this.cachedStatus;
  }

  // Synchronous accessors use cached status (call getStatus() first to refresh)
  get isPaused(): boolean {
    return this.cachedStatus?.isPaused || false;
  }

  getCurrentItem(): any | null {
    return this.cachedStatus?.currentItem || null;
  }

  getProgress(): { completed: number; total: number; remaining: string[] } {
    if (!this.cachedStatus) {
      return { completed: 0, total: 0, remaining: [] };
    }
    const remaining = this.cachedStatus.items
      .filter((i: any) => i.status !== 'completed')
      .map((i: any) => i.item_text);
    return {
      completed: this.cachedStatus.completed,
      total: this.cachedStatus.total,
      remaining
    };
  }

  isComplete(): boolean {
    if (!this.cachedStatus) return true;
    return this.cachedStatus.completed === this.cachedStatus.total;
  }
}

/**
 * Legacy in-memory Agenda Manager
 * Used as fallback when thread ID is not available
 */
export class AgendaManager {
  private items: Array<{ index: number; text: string; status: string; startedAt?: number; completedAt?: number }>;
  private currentIndex = 0;
  private isPausedState = false;
  private pausedForQuery?: string;

  constructor(parsedAgenda: Array<{ index: number; text: string; status: string }>) {
    this.items = parsedAgenda.map(item => ({ ...item }));
    console.log(`[AGENDA-LEGACY] Initialized with ${this.items.length} items`);
  }

  startItem(index?: number) {
    const idx = index ?? this.currentIndex;
    if (this.items[idx]) {
      this.items[idx].status = 'in_progress';
      this.items[idx].startedAt = Date.now();
      this.currentIndex = idx;
      console.log(`[AGENDA-LEGACY] Started item ${idx}: "${this.items[idx].text.substring(0, 40)}..."`);
    }
  }

  completeCurrentItem() {
    if (this.items[this.currentIndex]) {
      this.items[this.currentIndex].status = 'completed';
      this.items[this.currentIndex].completedAt = Date.now();
      console.log(`[AGENDA-LEGACY] Completed item ${this.currentIndex}`);
      
      // Find next pending
      const nextIdx = this.items.findIndex(
        (i, idx) => idx > this.currentIndex && i.status === 'pending'
      );
      if (nextIdx !== -1) {
        this.currentIndex = nextIdx;
      }
    }
  }

  pauseForQuery(userQuery: string) {
    if (this.items[this.currentIndex]?.status === 'in_progress') {
      this.items[this.currentIndex].status = 'paused';
      this.isPausedState = true;
      this.pausedForQuery = userQuery;
      console.log(`[AGENDA-LEGACY] Paused for user query: "${userQuery.substring(0, 40)}..."`);
    }
  }

  resume() {
    if (this.isPausedState && this.items[this.currentIndex]) {
      this.items[this.currentIndex].status = 'in_progress';
      this.isPausedState = false;
      this.pausedForQuery = undefined;
      console.log(`[AGENDA-LEGACY] Resumed item ${this.currentIndex}`);
    }
  }

  getResumeHint(): string | null {
    if (!this.isPausedState) return null;
    const item = this.items[this.currentIndex];
    return item ? `Getting back to: ${item.text}` : null;
  }

  getCurrentItem() {
    return this.items[this.currentIndex] || null;
  }

  getProgress(): { completed: number; total: number; remaining: string[] } {
    const completed = this.items.filter(i => i.status === 'completed').length;
    const remaining = this.items.filter(i => i.status !== 'completed').map(i => i.text);
    return { completed, total: this.items.length, remaining };
  }

  isComplete(): boolean {
    return this.items.every(i => i.status === 'completed');
  }

  get isPaused(): boolean {
    return this.isPausedState;
  }
}
