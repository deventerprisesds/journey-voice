export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_threads: {
        Row: {
          created_at: string
          id: string
          openai_thread_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          openai_thread_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          openai_thread_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      assignment_history: {
        Row: {
          assignment_id: string
          changed_at: string
          changed_fields: string[] | null
          id: string
          new_values: Json | null
          old_values: Json | null
          user_id: string
        }
        Insert: {
          assignment_id: string
          changed_at?: string
          changed_fields?: string[] | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          user_id: string
        }
        Update: {
          assignment_id?: string
          changed_at?: string
          changed_fields?: string[] | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_history_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          course_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          feedback: string | null
          id: string
          points: number | null
          priority: string
          sheet_row_number: number | null
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          feedback?: string | null
          id?: string
          points?: number | null
          priority?: string
          sheet_row_number?: number | null
          status?: string
          title: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          feedback?: string | null
          id?: string
          points?: number | null
          priority?: string
          sheet_row_number?: number | null
          status?: string
          title?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_knowledge_chunks: {
        Row: {
          assistant_id: string
          content: string
          created_at: string
          embedding: string | null
          id: string
          metadata: Json | null
          source_type: string
          user_id: string
        }
        Insert: {
          assistant_id: string
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          source_type: string
          user_id: string
        }
        Update: {
          assistant_id?: string
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json | null
          source_type?: string
          user_id?: string
        }
        Relationships: []
      }
      boards: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          position: number
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean | null
          name: string
          position?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          position?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calendar_connections: {
        Row: {
          access_token: string
          connected_services: Json | null
          created_at: string
          expires_at: string | null
          id: string
          is_active: boolean
          provider: string
          provider_account_email: string
          provider_account_id: string
          refresh_token: string | null
          scope: string | null
          scopes: string[] | null
          service_type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          connected_services?: Json | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          provider: string
          provider_account_email: string
          provider_account_id: string
          refresh_token?: string | null
          scope?: string | null
          scopes?: string[] | null
          service_type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          connected_services?: Json | null
          created_at?: string
          expires_at?: string | null
          id?: string
          is_active?: boolean
          provider?: string
          provider_account_email?: string
          provider_account_id?: string
          refresh_token?: string | null
          scope?: string | null
          scopes?: string[] | null
          service_type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      class_schedules: {
        Row: {
          course_name: string
          created_at: string
          date: string
          end_time: string
          id: string
          instructor: string | null
          is_online: boolean | null
          location: string | null
          sheet_row_number: number | null
          sheet_source: string
          start_time: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          course_name: string
          created_at?: string
          date: string
          end_time: string
          id?: string
          instructor?: string | null
          is_online?: boolean | null
          location?: string | null
          sheet_row_number?: number | null
          sheet_source: string
          start_time: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          course_name?: string
          created_at?: string
          date?: string
          end_time?: string
          id?: string
          instructor?: string | null
          is_online?: boolean | null
          location?: string | null
          sheet_row_number?: number | null
          sheet_source?: string
          start_time?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      columns: {
        Row: {
          board_id: string
          created_at: string
          id: string
          name: string
          position: number
          status: Database["public"]["Enums"]["task_status"]
          updated_at: string
        }
        Insert: {
          board_id: string
          created_at?: string
          id?: string
          name: string
          position?: number
          status: Database["public"]["Enums"]["task_status"]
          updated_at?: string
        }
        Update: {
          board_id?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          status?: Database["public"]["Enums"]["task_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "columns_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_embeddings: {
        Row: {
          content: string
          embedding: string | null
          id: string
          message_type: string
          metadata: Json | null
          thread_id: string | null
          timestamp: string
          user_id: string
          voice_session_id: string | null
        }
        Insert: {
          content: string
          embedding?: string | null
          id?: string
          message_type: string
          metadata?: Json | null
          thread_id?: string | null
          timestamp?: string
          user_id: string
          voice_session_id?: string | null
        }
        Update: {
          content?: string
          embedding?: string | null
          id?: string
          message_type?: string
          metadata?: Json | null
          thread_id?: string | null
          timestamp?: string
          user_id?: string
          voice_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_embeddings_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          audio_transcript: string | null
          content: string
          created_at: string
          id: string
          metadata: Json | null
          role: string
          thread_id: string | null
          user_id: string
          voice_session_id: string | null
        }
        Insert: {
          audio_transcript?: string | null
          content: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role: string
          thread_id?: string | null
          user_id: string
          voice_session_id?: string | null
        }
        Update: {
          audio_transcript?: string | null
          content?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role?: string
          thread_id?: string | null
          user_id?: string
          voice_session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "ai_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          code: string | null
          color: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          code?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      delivery_logs: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          notification_id: string
          response_data: Json | null
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          notification_id: string
          response_data?: Json | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          notification_id?: string
          response_data?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "delivery_logs_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "scheduled_notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      external_calendar_events: {
        Row: {
          calendar_id: string
          connection_id: string
          created_at: string
          description: string | null
          end_time: string
          external_event_id: string
          id: string
          is_all_day: boolean
          last_synced_at: string
          location: string | null
          start_time: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          calendar_id: string
          connection_id: string
          created_at?: string
          description?: string | null
          end_time: string
          external_event_id: string
          id?: string
          is_all_day?: boolean
          last_synced_at?: string
          location?: string | null
          start_time: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          calendar_id?: string
          connection_id?: string
          created_at?: string
          description?: string | null
          end_time?: string
          external_event_id?: string
          id?: string
          is_all_day?: boolean
          last_synced_at?: string
          location?: string | null
          start_time?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_calendar_events_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "calendar_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      extracted_content: {
        Row: {
          case_studies: string[] | null
          charts_tables: Json | null
          created_at: string
          digital_products: string[] | null
          extracted_at: string
          file_name: string
          file_path: string
          frameworks: string[] | null
          id: string
          key_concepts: string[] | null
          key_terms: string[] | null
          real_world_scenarios: string[] | null
          software_tools: string[] | null
          topic_id: string
          user_id: string
        }
        Insert: {
          case_studies?: string[] | null
          charts_tables?: Json | null
          created_at?: string
          digital_products?: string[] | null
          extracted_at?: string
          file_name: string
          file_path: string
          frameworks?: string[] | null
          id?: string
          key_concepts?: string[] | null
          key_terms?: string[] | null
          real_world_scenarios?: string[] | null
          software_tools?: string[] | null
          topic_id: string
          user_id: string
        }
        Update: {
          case_studies?: string[] | null
          charts_tables?: Json | null
          created_at?: string
          digital_products?: string[] | null
          extracted_at?: string
          file_name?: string
          file_path?: string
          frameworks?: string[] | null
          id?: string
          key_concepts?: string[] | null
          key_terms?: string[] | null
          real_world_scenarios?: string[] | null
          software_tools?: string[] | null
          topic_id?: string
          user_id?: string
        }
        Relationships: []
      }
      itineraries: {
        Row: {
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          location: string | null
          start_date: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          start_date?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          location?: string | null
          start_date?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      itinerary_items: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          end_time: string | null
          id: string
          itinerary_id: string
          location: string | null
          notes: string | null
          start_time: string | null
          title: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          end_time?: string | null
          id?: string
          itinerary_id: string
          location?: string | null
          notes?: string | null
          start_time?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          end_time?: string | null
          id?: string
          itinerary_id?: string
          location?: string | null
          notes?: string | null
          start_time?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_items_itinerary_id_fkey"
            columns: ["itinerary_id"]
            isOneToOne: false
            referencedRelation: "itineraries"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_prefs: {
        Row: {
          channels: Database["public"]["Enums"]["notification_channel"][] | null
          created_at: string
          daily_digest_enabled: boolean | null
          due_reminders_enabled: boolean | null
          id: string
          overdue_reminders_enabled: boolean | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          task_created_enabled: boolean | null
          timezone: string | null
          updated_at: string
          user_id: string
          weekly_digest_enabled: boolean | null
        }
        Insert: {
          channels?:
            | Database["public"]["Enums"]["notification_channel"][]
            | null
          created_at?: string
          daily_digest_enabled?: boolean | null
          due_reminders_enabled?: boolean | null
          id?: string
          overdue_reminders_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          task_created_enabled?: boolean | null
          timezone?: string | null
          updated_at?: string
          user_id: string
          weekly_digest_enabled?: boolean | null
        }
        Update: {
          channels?:
            | Database["public"]["Enums"]["notification_channel"][]
            | null
          created_at?: string
          daily_digest_enabled?: boolean | null
          due_reminders_enabled?: boolean | null
          id?: string
          overdue_reminders_enabled?: boolean | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          task_created_enabled?: boolean | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
          weekly_digest_enabled?: boolean | null
        }
        Relationships: []
      }
      oauth_token_audit: {
        Row: {
          action_type: string
          connection_id: string
          created_at: string
          id: string
          ip_address: unknown | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          connection_id: string
          created_at?: string
          id?: string
          ip_address?: unknown | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          connection_id?: string
          created_at?: string
          id?: string
          ip_address?: unknown | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profile_access_log: {
        Row: {
          access_type: string
          accessed_user_id: string
          accessor_user_id: string
          id: string
          ip_address: unknown | null
          timestamp: string | null
          user_agent: string | null
        }
        Insert: {
          access_type: string
          accessed_user_id: string
          accessor_user_id: string
          id?: string
          ip_address?: unknown | null
          timestamp?: string | null
          user_agent?: string | null
        }
        Update: {
          access_type?: string
          accessed_user_id?: string
          accessor_user_id?: string
          id?: string
          ip_address?: unknown | null
          timestamp?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_documents: {
        Row: {
          file_name: string
          file_size: number
          file_type: string
          id: string
          last_used_at: string
          project_id: string
          storage_path: string
          task_id: string | null
          uploaded_at: string
          user_id: string
        }
        Insert: {
          file_name: string
          file_size: number
          file_type: string
          id?: string
          last_used_at?: string
          project_id: string
          storage_path: string
          task_id?: string | null
          uploaded_at?: string
          user_id: string
        }
        Update: {
          file_name?: string
          file_size?: number
          file_type?: string
          id?: string
          last_used_at?: string
          project_id?: string
          storage_path?: string
          task_id?: string | null
          uploaded_at?: string
          user_id?: string
        }
        Relationships: []
      }
      schedule_history: {
        Row: {
          changed_at: string
          changed_fields: string[] | null
          id: string
          new_values: Json | null
          old_values: Json | null
          schedule_id: string
          user_id: string
        }
        Insert: {
          changed_at?: string
          changed_fields?: string[] | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          schedule_id: string
          user_id: string
        }
        Update: {
          changed_at?: string
          changed_fields?: string[] | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          schedule_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_history_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "class_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_notifications: {
        Row: {
          body: string
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          notification_type: string
          original_scheduled_for: string | null
          processing_at: string | null
          processing_instance: string | null
          queued_during_quiet: boolean | null
          scheduled_for: string
          task_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          notification_type: string
          original_scheduled_for?: string | null
          processing_at?: string | null
          processing_instance?: string | null
          queued_during_quiet?: boolean | null
          scheduled_for: string
          task_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          delivered_at?: string | null
          failed_at?: string | null
          failure_reason?: string | null
          id?: string
          notification_type?: string
          original_scheduled_for?: string | null
          processing_at?: string | null
          processing_instance?: string | null
          queued_during_quiet?: boolean | null
          scheduled_for?: string
          task_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      sources: {
        Row: {
          config: Json | null
          created_at: string
          id: string
          name: string
          source_type: Database["public"]["Enums"]["task_source"]
          updated_at: string
          user_id: string
        }
        Insert: {
          config?: Json | null
          created_at?: string
          id?: string
          name: string
          source_type: Database["public"]["Enums"]["task_source"]
          updated_at?: string
          user_id: string
        }
        Update: {
          config?: Json | null
          created_at?: string
          id?: string
          name?: string
          source_type?: Database["public"]["Enums"]["task_source"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sync_config: {
        Row: {
          config_data: Json
          created_at: string
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          service_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          config_data?: Json
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          service_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          config_data?: Json
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          service_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sync_logs: {
        Row: {
          completed_at: string | null
          error_message: string | null
          id: string
          records_added: number | null
          records_processed: number | null
          records_updated: number | null
          service_type: string
          started_at: string
          status: string
          sync_type: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          records_added?: number | null
          records_processed?: number | null
          records_updated?: number | null
          service_type: string
          started_at?: string
          status: string
          sync_type: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          id?: string
          records_added?: number | null
          records_processed?: number | null
          records_updated?: number | null
          service_type?: string
          started_at?: string
          status?: string
          sync_type?: string
          user_id?: string
        }
        Relationships: []
      }
      task_columns: {
        Row: {
          column_id: string
          created_at: string
          id: string
          position: number
          task_id: string
        }
        Insert: {
          column_id: string
          created_at?: string
          id?: string
          position?: number
          task_id: string
        }
        Update: {
          column_id?: string
          created_at?: string
          id?: string
          position?: number
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_columns_column_id_fkey"
            columns: ["column_id"]
            isOneToOne: false
            referencedRelation: "columns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_columns_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          new_values: Json | null
          old_values: Json | null
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          blocked_by: string[] | null
          board_id: string
          category: Database["public"]["Enums"]["task_category"]
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          end_time: string | null
          estimate_minutes: number | null
          external_event_id: string | null
          id: string
          is_scheduled: boolean
          priority: Database["public"]["Enums"]["task_priority"]
          reminder_minutes: number | null
          source_id: string | null
          start_time: string | null
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          blocked_by?: string[] | null
          board_id: string
          category?: Database["public"]["Enums"]["task_category"]
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          end_time?: string | null
          estimate_minutes?: number | null
          external_event_id?: string | null
          id?: string
          is_scheduled?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          reminder_minutes?: number | null
          source_id?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          blocked_by?: string[] | null
          board_id?: string
          category?: Database["public"]["Enums"]["task_category"]
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          end_time?: string | null
          estimate_minutes?: number | null
          external_event_id?: string | null
          id?: string
          is_scheduled?: boolean
          priority?: Database["public"]["Enums"]["task_priority"]
          reminder_minutes?: number | null
          source_id?: string | null
          start_time?: string | null
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_board_id_fkey"
            columns: ["board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      binary_quantize: {
        Args: { "": string } | { "": unknown }
        Returns: unknown
      }
      claim_due_notifications: {
        Args: { claim_limit?: number; instance_id?: string }
        Returns: {
          body: string
          created_at: string
          delivered_at: string | null
          failed_at: string | null
          failure_reason: string | null
          id: string
          notification_type: string
          original_scheduled_for: string | null
          processing_at: string | null
          processing_instance: string | null
          queued_during_quiet: boolean | null
          scheduled_for: string
          task_id: string | null
          title: string
          user_id: string
        }[]
      }
      decrypt_token: {
        Args: { encrypted_token: string; p_user_id: string }
        Returns: string
      }
      encrypt_token: {
        Args: { p_user_id: string; token_value: string }
        Returns: string
      }
      get_calendar_connection_tokens: {
        Args: { _connection_id: string }
        Returns: {
          access_token: string
          expires_at: string
          refresh_token: string
        }[]
      }
      get_calendar_connections_safe: {
        Args: Record<PropertyKey, never>
        Returns: {
          created_at: string
          expires_at: string
          id: string
          is_active: boolean
          provider: string
          provider_account_email: string
          provider_account_id: string
          scope: string
          updated_at: string
          user_id: string
        }[]
      }
      get_calendar_connections_secure: {
        Args: Record<PropertyKey, never>
        Returns: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          is_active: boolean
          provider: string
          provider_account_email: string
          provider_account_id: string
          refresh_token: string
          scope: string
          updated_at: string
          user_id: string
        }[]
      }
      get_current_user_role: {
        Args: Record<PropertyKey, never>
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_masked_profiles: {
        Args: Record<PropertyKey, never>
        Returns: {
          avatar_url: string
          created_at: string
          full_name: string
          id: string
          masked_email: string
          masked_phone: string
          updated_at: string
          user_id: string
        }[]
      }
      halfvec_avg: {
        Args: { "": number[] }
        Returns: unknown
      }
      halfvec_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      halfvec_send: {
        Args: { "": unknown }
        Returns: string
      }
      halfvec_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      hnsw_bit_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnsw_halfvec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnsw_sparsevec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      hnswhandler: {
        Args: { "": unknown }
        Returns: unknown
      }
      insert_calendar_connection: {
        Args: {
          _access_token: string
          _expires_at?: string
          _provider: string
          _provider_account_email: string
          _provider_account_id: string
          _refresh_token?: string
          _scope?: string
        }
        Returns: string
      }
      ivfflat_bit_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflat_halfvec_support: {
        Args: { "": unknown }
        Returns: unknown
      }
      ivfflathandler: {
        Args: { "": unknown }
        Returns: unknown
      }
      l2_norm: {
        Args: { "": unknown } | { "": unknown }
        Returns: number
      }
      l2_normalize: {
        Args: { "": string } | { "": unknown } | { "": unknown }
        Returns: string
      }
      log_oauth_token_access: {
        Args: {
          _action_type: string
          _connection_id: string
          _ip_address?: unknown
          _user_agent?: string
        }
        Returns: undefined
      }
      log_profile_access: {
        Args: {
          _access_type: string
          _accessed_user_id: string
          _ip_address?: unknown
          _user_agent?: string
        }
        Returns: undefined
      }
      match_assistant_knowledge: {
        Args: {
          assistant_id_param: string
          match_count?: number
          match_threshold?: number
          query_embedding: string
          user_id_param: string
        }
        Returns: {
          content: string
          id: string
          metadata: Json
          similarity: number
          source_type: string
        }[]
      }
      match_conversation_embeddings: {
        Args: {
          match_count?: number
          match_threshold?: number
          query_embedding: string
          thread_id_param?: string
          user_id_param: string
        }
        Returns: {
          content: string
          id: string
          message_timestamp: string
          message_type: string
          metadata: Json
          similarity: number
        }[]
      }
      revoke_calendar_connection: {
        Args: { _connection_id: string }
        Returns: boolean
      }
      sparsevec_out: {
        Args: { "": unknown }
        Returns: unknown
      }
      sparsevec_send: {
        Args: { "": unknown }
        Returns: string
      }
      sparsevec_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
      update_calendar_connection_tokens: {
        Args: {
          _access_token: string
          _connection_id: string
          _expires_at?: string
          _refresh_token?: string
        }
        Returns: boolean
      }
      vector_avg: {
        Args: { "": number[] }
        Returns: string
      }
      vector_dims: {
        Args: { "": string } | { "": unknown }
        Returns: number
      }
      vector_norm: {
        Args: { "": string }
        Returns: number
      }
      vector_out: {
        Args: { "": string }
        Returns: unknown
      }
      vector_send: {
        Args: { "": string }
        Returns: string
      }
      vector_typmod_in: {
        Args: { "": unknown[] }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "user"
      notification_channel:
        | "EMAIL"
        | "SMS"
        | "SLACK"
        | "PUSH"
        | "OUTLOOK_EVENT"
        | "GOOGLE_EVENT"
      task_category: "LIFE" | "CAREER" | "VENTURES" | "EDUCATION"
      task_priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT"
      task_source: "CHAT" | "EMBA_SHEET" | "MIT_SHEET" | "MANUAL"
      task_status:
        | "BACKLOG"
        | "TODO"
        | "DOING"
        | "DONE"
        | "BLOCKED"
        | "CAREER"
        | "PROF_EDUCATION"
        | "VENTURES"
        | "PLANNING"
        | "READY"
        | "UP_NEXT"
        | "LIFE"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      notification_channel: [
        "EMAIL",
        "SMS",
        "SLACK",
        "PUSH",
        "OUTLOOK_EVENT",
        "GOOGLE_EVENT",
      ],
      task_category: ["LIFE", "CAREER", "VENTURES", "EDUCATION"],
      task_priority: ["LOW", "MEDIUM", "HIGH", "URGENT"],
      task_source: ["CHAT", "EMBA_SHEET", "MIT_SHEET", "MANUAL"],
      task_status: [
        "BACKLOG",
        "TODO",
        "DOING",
        "DONE",
        "BLOCKED",
        "CAREER",
        "PROF_EDUCATION",
        "VENTURES",
        "PLANNING",
        "READY",
        "UP_NEXT",
        "LIFE",
      ],
    },
  },
} as const
