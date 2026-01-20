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
      app_builder_artifacts: {
        Row: {
          artifact_number: number
          category: string
          content: string
          created_at: string | null
          description: string | null
          id: string
          metadata: Json | null
          title: string
          updated_at: string | null
        }
        Insert: {
          artifact_number: number
          category: string
          content: string
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          title: string
          updated_at?: string | null
        }
        Update: {
          artifact_number?: number
          category?: string
          content?: string
          created_at?: string | null
          description?: string | null
          id?: string
          metadata?: Json | null
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      assignment_artifacts: {
        Row: {
          artifact_type: string
          assignment_id: string | null
          content: string | null
          created_at: string | null
          id: string
          metadata: Json | null
          status: string | null
          title: string | null
          updated_at: string | null
          user_id: string
          version: number | null
          workflow_type: string
        }
        Insert: {
          artifact_type: string
          assignment_id?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          user_id: string
          version?: number | null
          workflow_type: string
        }
        Update: {
          artifact_type?: string
          assignment_id?: string | null
          content?: string | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          status?: string | null
          title?: string | null
          updated_at?: string | null
          user_id?: string
          version?: number | null
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_artifacts_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
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
      assignment_outlines: {
        Row: {
          assignment_id: string | null
          created_at: string | null
          id: string
          outline_structure: Json
          status: string | null
          updated_at: string | null
          user_id: string
          workflow_type: string
        }
        Insert: {
          assignment_id?: string | null
          created_at?: string | null
          id?: string
          outline_structure: Json
          status?: string | null
          updated_at?: string | null
          user_id: string
          workflow_type: string
        }
        Update: {
          assignment_id?: string | null
          created_at?: string | null
          id?: string
          outline_structure?: Json
          status?: string | null
          updated_at?: string | null
          user_id?: string
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_outlines_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_requirements: {
        Row: {
          assignment_id: string | null
          created_at: string | null
          description: string
          extracted_at: string | null
          id: string
          is_met: boolean | null
          last_run_id: string | null
          metadata: Json | null
          openai_thread_id: string | null
          requirement_type: string
          status: string | null
          user_id: string
          weight: number | null
          workflow_type: string
        }
        Insert: {
          assignment_id?: string | null
          created_at?: string | null
          description: string
          extracted_at?: string | null
          id?: string
          is_met?: boolean | null
          last_run_id?: string | null
          metadata?: Json | null
          openai_thread_id?: string | null
          requirement_type: string
          status?: string | null
          user_id: string
          weight?: number | null
          workflow_type: string
        }
        Update: {
          assignment_id?: string | null
          created_at?: string | null
          description?: string
          extracted_at?: string | null
          id?: string
          is_met?: boolean | null
          last_run_id?: string | null
          metadata?: Json | null
          openai_thread_id?: string | null
          requirement_type?: string
          status?: string | null
          user_id?: string
          weight?: number | null
          workflow_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_requirements_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      assignment_user_context: {
        Row: {
          assignment_id: string
          context_file_urls: Json | null
          created_at: string | null
          id: string
          persistent_instructions: string | null
          supplemental_context: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          assignment_id: string
          context_file_urls?: Json | null
          created_at?: string | null
          id?: string
          persistent_instructions?: string | null
          supplemental_context?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          assignment_id?: string
          context_file_urls?: Json | null
          created_at?: string | null
          id?: string
          persistent_instructions?: string | null
          supplemental_context?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assignment_user_context_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments: {
        Row: {
          academic_semester: string | null
          assignment_url: string | null
          category: string | null
          course_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          feedback: string | null
          id: string
          level_of_effort: string | null
          points: number | null
          priority: string
          program_id: string | null
          sheet_row_number: number | null
          status: string
          title: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          academic_semester?: string | null
          assignment_url?: string | null
          category?: string | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          feedback?: string | null
          id?: string
          level_of_effort?: string | null
          points?: number | null
          priority?: string
          program_id?: string | null
          sheet_row_number?: number | null
          status?: string
          title: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          academic_semester?: string | null
          assignment_url?: string | null
          category?: string | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          feedback?: string | null
          id?: string
          level_of_effort?: string | null
          points?: number | null
          priority?: string
          program_id?: string | null
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
          {
            foreignKeyName: "assignments_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments_mit: {
        Row: {
          academic_semester: string | null
          assignment_url: string | null
          category: string | null
          course_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          feedback: string | null
          id: string
          level_of_effort: string | null
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
          academic_semester?: string | null
          assignment_url?: string | null
          category?: string | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          feedback?: string | null
          id?: string
          level_of_effort?: string | null
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
          academic_semester?: string | null
          assignment_url?: string | null
          category?: string | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          feedback?: string | null
          id?: string
          level_of_effort?: string | null
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
            foreignKeyName: "assignments_mit_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      assignments_mit_history: {
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
            foreignKeyName: "assignments_mit_history_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments_mit"
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
      call_messages: {
        Row: {
          audio_duration_ms: number | null
          call_session_id: string
          completed_at: string | null
          content: string
          id: string
          latency_ms: number | null
          message_index: number
          metadata: Json | null
          role: string
          started_at: string | null
          tool_input: Json | null
          tool_name: string | null
          tool_output: Json | null
          user_id: string
          word_count: number | null
        }
        Insert: {
          audio_duration_ms?: number | null
          call_session_id: string
          completed_at?: string | null
          content: string
          id?: string
          latency_ms?: number | null
          message_index: number
          metadata?: Json | null
          role: string
          started_at?: string | null
          tool_input?: Json | null
          tool_name?: string | null
          tool_output?: Json | null
          user_id: string
          word_count?: number | null
        }
        Update: {
          audio_duration_ms?: number | null
          call_session_id?: string
          completed_at?: string | null
          content?: string
          id?: string
          latency_ms?: number | null
          message_index?: number
          metadata?: Json | null
          role?: string
          started_at?: string | null
          tool_input?: Json | null
          tool_name?: string | null
          tool_output?: Json | null
          user_id?: string
          word_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "call_messages_call_session_id_fkey"
            columns: ["call_session_id"]
            isOneToOne: false
            referencedRelation: "call_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      call_sessions: {
        Row: {
          call_context: string | null
          call_sid: string
          direction: string
          duration_seconds: number | null
          ended_at: string | null
          first_audio_at: string | null
          from_number: string | null
          greeting_latency_ms: number | null
          id: string
          metadata: Json | null
          started_at: string | null
          stream_sid: string | null
          to_number: string | null
          tts_provider: string | null
          user_id: string
        }
        Insert: {
          call_context?: string | null
          call_sid: string
          direction: string
          duration_seconds?: number | null
          ended_at?: string | null
          first_audio_at?: string | null
          from_number?: string | null
          greeting_latency_ms?: number | null
          id?: string
          metadata?: Json | null
          started_at?: string | null
          stream_sid?: string | null
          to_number?: string | null
          tts_provider?: string | null
          user_id: string
        }
        Update: {
          call_context?: string | null
          call_sid?: string
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          first_audio_at?: string | null
          from_number?: string | null
          greeting_latency_ms?: number | null
          id?: string
          metadata?: Json | null
          started_at?: string | null
          stream_sid?: string | null
          to_number?: string | null
          tts_provider?: string | null
          user_id?: string
        }
        Relationships: []
      }
      case_study_analyses: {
        Row: {
          assignment_id: string | null
          case_analysis: string | null
          case_extraction: string | null
          case_text: string | null
          completed_sections: Json | null
          concepts_taught: string | null
          conceptual_learning: string | null
          created_at: string | null
          draft_writeup: string | null
          extracted_data: string | null
          id: string
          missing_extracts: string | null
          outline: string | null
          questions: string | null
          sourced_answers: string | null
          summaries: string | null
          supplemental_context: string | null
          updated_at: string | null
          user_id: string | null
          verification_needed: string | null
        }
        Insert: {
          assignment_id?: string | null
          case_analysis?: string | null
          case_extraction?: string | null
          case_text?: string | null
          completed_sections?: Json | null
          concepts_taught?: string | null
          conceptual_learning?: string | null
          created_at?: string | null
          draft_writeup?: string | null
          extracted_data?: string | null
          id?: string
          missing_extracts?: string | null
          outline?: string | null
          questions?: string | null
          sourced_answers?: string | null
          summaries?: string | null
          supplemental_context?: string | null
          updated_at?: string | null
          user_id?: string | null
          verification_needed?: string | null
        }
        Update: {
          assignment_id?: string | null
          case_analysis?: string | null
          case_extraction?: string | null
          case_text?: string | null
          completed_sections?: Json | null
          concepts_taught?: string | null
          conceptual_learning?: string | null
          created_at?: string | null
          draft_writeup?: string | null
          extracted_data?: string | null
          id?: string
          missing_extracts?: string | null
          outline?: string | null
          questions?: string | null
          sourced_answers?: string | null
          summaries?: string | null
          supplemental_context?: string | null
          updated_at?: string | null
          user_id?: string | null
          verification_needed?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_study_analyses_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          context_data: Json | null
          created_at: string | null
          id: string
          messages: Json | null
          project_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          context_data?: Json | null
          created_at?: string | null
          id?: string
          messages?: Json | null
          project_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          context_data?: Json | null
          created_at?: string | null
          id?: string
          messages?: Json | null
          project_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      class_schedules: {
        Row: {
          course_id: string | null
          course_name: string
          created_at: string
          date: string
          end_time: string
          id: string
          instructor: string | null
          is_online: boolean | null
          location: string | null
          program_id: string | null
          sheet_row_number: number | null
          sheet_source: string
          start_time: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id?: string | null
          course_name: string
          created_at?: string
          date: string
          end_time: string
          id?: string
          instructor?: string | null
          is_online?: boolean | null
          location?: string | null
          program_id?: string | null
          sheet_row_number?: number | null
          sheet_source: string
          start_time: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string | null
          course_name?: string
          created_at?: string
          date?: string
          end_time?: string
          id?: string
          instructor?: string | null
          is_online?: boolean | null
          location?: string | null
          program_id?: string | null
          sheet_row_number?: number | null
          sheet_source?: string
          start_time?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_schedules_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_class_schedules_course"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
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
      core_insights: {
        Row: {
          course_id: string
          created_at: string
          id: string
          insight_text: string
          insight_type: string
          is_custom: boolean
          source_document_id: string | null
          source_document_name: string | null
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id?: string
          insight_text: string
          insight_type: string
          is_custom?: boolean
          source_document_id?: string | null
          source_document_name?: string | null
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          insight_text?: string
          insight_type?: string
          is_custom?: boolean
          source_document_id?: string | null
          source_document_name?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "core_insights_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "core_insights_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "extracted_content"
            referencedColumns: ["id"]
          },
        ]
      }
      core_learnings: {
        Row: {
          category: string | null
          content: Json | null
          course_id: string | null
          created_at: string
          description: string | null
          id: string
          importance_level: number | null
          learning_type: Database["public"]["Enums"]["learning_type"]
          notes: string | null
          position: number | null
          source_extraction_id: string | null
          source_file_name: string | null
          tags: string[] | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          content?: Json | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          importance_level?: number | null
          learning_type: Database["public"]["Enums"]["learning_type"]
          notes?: string | null
          position?: number | null
          source_extraction_id?: string | null
          source_file_name?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          content?: Json | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          importance_level?: number | null
          learning_type?: Database["public"]["Enums"]["learning_type"]
          notes?: string | null
          position?: number | null
          source_extraction_id?: string | null
          source_file_name?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "core_learnings_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "core_learnings_source_extraction_id_fkey"
            columns: ["source_extraction_id"]
            isOneToOne: false
            referencedRelation: "extracted_content"
            referencedColumns: ["id"]
          },
        ]
      }
      course_materials: {
        Row: {
          course_id: string
          created_at: string
          description: string | null
          duration_seconds: number | null
          file_size: number | null
          id: string
          local_storage_path: string | null
          material_type: string
          mime_type: string | null
          module_id: string | null
          onedrive_file_id: string | null
          onedrive_path: string | null
          onedrive_share_link: string | null
          title: string
          total_slides: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          file_size?: number | null
          id?: string
          local_storage_path?: string | null
          material_type: string
          mime_type?: string | null
          module_id?: string | null
          onedrive_file_id?: string | null
          onedrive_path?: string | null
          onedrive_share_link?: string | null
          title: string
          total_slides?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string | null
          duration_seconds?: number | null
          file_size?: number | null
          id?: string
          local_storage_path?: string | null
          material_type?: string
          mime_type?: string | null
          module_id?: string | null
          onedrive_file_id?: string | null
          onedrive_path?: string | null
          onedrive_share_link?: string | null
          title?: string
          total_slides?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_materials_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_materials_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modules"
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
          onedrive_folder_id: string | null
          onedrive_folder_name: string | null
          onedrive_folder_path: string | null
          onenote_notebook_id: string | null
          onenote_notebook_name: string | null
          onenote_section_id: string | null
          onenote_section_name: string | null
          program_id: string | null
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
          onedrive_folder_id?: string | null
          onedrive_folder_name?: string | null
          onedrive_folder_path?: string | null
          onenote_notebook_id?: string | null
          onenote_notebook_name?: string | null
          onenote_section_id?: string | null
          onenote_section_name?: string | null
          program_id?: string | null
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
          onedrive_folder_id?: string | null
          onedrive_folder_name?: string | null
          onedrive_folder_path?: string | null
          onenote_notebook_id?: string | null
          onenote_notebook_name?: string | null
          onenote_section_id?: string | null
          onenote_section_name?: string | null
          program_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      data_source_mappings: {
        Row: {
          created_at: string | null
          data_type: string
          id: string
          last_synced_at: string | null
          program_id: string
          source_identifier: string
          source_name: string | null
          source_type: string
          sync_config: Json | null
          sync_enabled: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          data_type: string
          id?: string
          last_synced_at?: string | null
          program_id: string
          source_identifier: string
          source_name?: string | null
          source_type: string
          sync_config?: Json | null
          sync_enabled?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          data_type?: string
          id?: string
          last_synced_at?: string | null
          program_id?: string
          source_identifier?: string
          source_name?: string | null
          source_type?: string
          sync_config?: Json | null
          sync_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_source_mappings_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
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
          assignment_guidance: string | null
          assumptions: Json | null
          atoms: Json | null
          career_application_notes: string[] | null
          case_approach: string | null
          case_comprehensive_summary: string | null
          case_facts_statistics: Json | null
          case_justification: string | null
          case_outcome: string | null
          case_players: Json | null
          case_problem: string | null
          case_studies: string[] | null
          charts_tables: Json | null
          comprehensive_summary: string | null
          content_type: string | null
          created_at: string
          digital_products: string[] | null
          extracted_at: string
          file_name: string
          file_path: string
          formulas: string[] | null
          frameworks: string[] | null
          id: string
          is_case_analysis: boolean | null
          key_concepts: string[] | null
          key_definitions: Json | null
          key_terms: string[] | null
          learning_objectives: string[] | null
          openai_file_id: string | null
          openai_vector_store_id: string | null
          quick_summary: string | null
          real_world_scenarios: string[] | null
          software_tools: string[] | null
          study_questions: Json | null
          topic_id: string
          user_id: string
        }
        Insert: {
          assignment_guidance?: string | null
          assumptions?: Json | null
          atoms?: Json | null
          career_application_notes?: string[] | null
          case_approach?: string | null
          case_comprehensive_summary?: string | null
          case_facts_statistics?: Json | null
          case_justification?: string | null
          case_outcome?: string | null
          case_players?: Json | null
          case_problem?: string | null
          case_studies?: string[] | null
          charts_tables?: Json | null
          comprehensive_summary?: string | null
          content_type?: string | null
          created_at?: string
          digital_products?: string[] | null
          extracted_at?: string
          file_name: string
          file_path: string
          formulas?: string[] | null
          frameworks?: string[] | null
          id?: string
          is_case_analysis?: boolean | null
          key_concepts?: string[] | null
          key_definitions?: Json | null
          key_terms?: string[] | null
          learning_objectives?: string[] | null
          openai_file_id?: string | null
          openai_vector_store_id?: string | null
          quick_summary?: string | null
          real_world_scenarios?: string[] | null
          software_tools?: string[] | null
          study_questions?: Json | null
          topic_id: string
          user_id: string
        }
        Update: {
          assignment_guidance?: string | null
          assumptions?: Json | null
          atoms?: Json | null
          career_application_notes?: string[] | null
          case_approach?: string | null
          case_comprehensive_summary?: string | null
          case_facts_statistics?: Json | null
          case_justification?: string | null
          case_outcome?: string | null
          case_players?: Json | null
          case_problem?: string | null
          case_studies?: string[] | null
          charts_tables?: Json | null
          comprehensive_summary?: string | null
          content_type?: string | null
          created_at?: string
          digital_products?: string[] | null
          extracted_at?: string
          file_name?: string
          file_path?: string
          formulas?: string[] | null
          frameworks?: string[] | null
          id?: string
          is_case_analysis?: boolean | null
          key_concepts?: string[] | null
          key_definitions?: Json | null
          key_terms?: string[] | null
          learning_objectives?: string[] | null
          openai_file_id?: string | null
          openai_vector_store_id?: string | null
          quick_summary?: string | null
          real_world_scenarios?: string[] | null
          software_tools?: string[] | null
          study_questions?: Json | null
          topic_id?: string
          user_id?: string
        }
        Relationships: []
      }
      form_field_mappings: {
        Row: {
          created_at: string | null
          field_name: string
          field_type: string
          id: string
          semantic_aliases: string[] | null
          shared_across_forms: string[] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          field_name: string
          field_type: string
          id?: string
          semantic_aliases?: string[] | null
          shared_across_forms?: string[] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          field_name?: string
          field_type?: string
          id?: string
          semantic_aliases?: string[] | null
          shared_across_forms?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      form_registry: {
        Row: {
          created_at: string | null
          depends_on_forms: string[] | null
          field_definitions: Json | null
          form_id: string
          form_name: string
          id: string
          task_ids: string[] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          depends_on_forms?: string[] | null
          field_definitions?: Json | null
          form_id: string
          form_name: string
          id?: string
          task_ids?: string[] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          depends_on_forms?: string[] | null
          field_definitions?: Json | null
          form_id?: string
          form_name?: string
          id?: string
          task_ids?: string[] | null
          updated_at?: string | null
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
      lecture_transcripts: {
        Row: {
          action_items: Json | null
          ai_summary: string | null
          audio_file_path: string
          course_id: string | null
          created_at: string
          duration_seconds: number | null
          id: string
          key_points: Json | null
          questions_asked: Json | null
          session_id: string
          transcript_text: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_items?: Json | null
          ai_summary?: string | null
          audio_file_path: string
          course_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          key_points?: Json | null
          questions_asked?: Json | null
          session_id: string
          transcript_text: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_items?: Json | null
          ai_summary?: string | null
          audio_file_path?: string
          course_id?: string | null
          created_at?: string
          duration_seconds?: number | null
          id?: string
          key_points?: Json | null
          questions_asked?: Json | null
          session_id?: string
          transcript_text?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_transcripts_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_transcripts_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "class_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_transcripts_segments: {
        Row: {
          created_at: string
          end_time: number
          id: string
          segment_number: number
          session_id: string
          slide_reference: string | null
          speaker: string | null
          start_time: number
          text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          end_time: number
          id?: string
          segment_number: number
          session_id: string
          slide_reference?: string | null
          speaker?: string | null
          start_time: number
          text: string
          user_id: string
        }
        Update: {
          created_at?: string
          end_time?: number
          id?: string
          segment_number?: number
          session_id?: string
          slide_reference?: string | null
          speaker?: string | null
          start_time?: number
          text?: string
          user_id?: string
        }
        Relationships: []
      }
      live_insights: {
        Row: {
          category: string
          confidence: number | null
          content: Json
          course_id: string | null
          created_at: string
          highlight_importance: number | null
          id: string
          insight_type: string
          session_id: string
          subcategory: string
          timestamp: string
          transcript_segment_id: string | null
          user_id: string
        }
        Insert: {
          category?: string
          confidence?: number | null
          content: Json
          course_id?: string | null
          created_at?: string
          highlight_importance?: number | null
          id?: string
          insight_type: string
          session_id: string
          subcategory?: string
          timestamp?: string
          transcript_segment_id?: string | null
          user_id: string
        }
        Update: {
          category?: string
          confidence?: number | null
          content?: Json
          course_id?: string | null
          created_at?: string
          highlight_importance?: number | null
          id?: string
          insight_type?: string
          session_id?: string
          subcategory?: string
          timestamp?: string
          transcript_segment_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_insights_transcript_segment_id_fkey"
            columns: ["transcript_segment_id"]
            isOneToOne: false
            referencedRelation: "lecture_transcripts_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      modules: {
        Row: {
          course_id: string
          created_at: string
          description: string | null
          end_date: string | null
          id: string
          is_prework: boolean | null
          module_number: number
          name: string
          start_date: string | null
          updated_at: string
          weekend_number: number | null
        }
        Insert: {
          course_id: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_prework?: boolean | null
          module_number: number
          name: string
          start_date?: string | null
          updated_at?: string
          weekend_number?: number | null
        }
        Update: {
          course_id?: string
          created_at?: string
          description?: string | null
          end_date?: string | null
          id?: string
          is_prework?: boolean | null
          module_number?: number
          name?: string
          start_date?: string | null
          updated_at?: string
          weekend_number?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "modules_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
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
          ip_address: unknown
          user_agent: string | null
          user_id: string
        }
        Insert: {
          action_type: string
          connection_id: string
          created_at?: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id: string
        }
        Update: {
          action_type?: string
          connection_id?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      openai_file_uploads: {
        Row: {
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          openai_file_id: string
          openai_vector_store_id: string | null
          source_id: string
          source_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          openai_file_id: string
          openai_vector_store_id?: string | null
          source_id: string
          source_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          openai_file_id?: string
          openai_vector_store_id?: string | null
          source_id?: string
          source_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      playback_state: {
        Row: {
          is_playing: boolean | null
          playback_speed: number
          playback_time: number
          session_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          is_playing?: boolean | null
          playback_speed?: number
          playback_time?: number
          session_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          is_playing?: boolean | null
          playback_speed?: number
          playback_time?: number
          session_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ppt_slide_texts: {
        Row: {
          created_at: string
          id: string
          material_id: string
          slide_number: number
          text: string
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          slide_number: number
          text: string
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          slide_number?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "ppt_slide_texts_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "course_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      ppt_slide_thumbnails: {
        Row: {
          created_at: string
          id: string
          material_id: string
          slide_number: number
          thumbnail_storage_path: string | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          slide_number: number
          thumbnail_storage_path?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          slide_number?: number
          thumbnail_storage_path?: string | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ppt_slide_thumbnails_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "course_materials"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_access_log: {
        Row: {
          access_type: string
          accessed_user_id: string
          accessor_user_id: string
          id: string
          ip_address: unknown
          timestamp: string | null
          user_agent: string | null
        }
        Insert: {
          access_type: string
          accessed_user_id: string
          accessor_user_id: string
          id?: string
          ip_address?: unknown
          timestamp?: string | null
          user_agent?: string | null
        }
        Update: {
          access_type?: string
          accessed_user_id?: string
          accessor_user_id?: string
          id?: string
          ip_address?: unknown
          timestamp?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      profile_access_rate_limit: {
        Row: {
          access_count: number | null
          created_at: string
          id: string
          user_id: string
          window_start: string
        }
        Insert: {
          access_count?: number | null
          created_at?: string
          id?: string
          user_id: string
          window_start?: string
        }
        Update: {
          access_count?: number | null
          created_at?: string
          id?: string
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          company: string | null
          created_at: string
          email: string | null
          first_name: string | null
          full_name: string | null
          id: string
          industry: string | null
          job_title: string | null
          last_name: string | null
          openai_vector_store_id: string | null
          phone: string | null
          updated_at: string
          user_id: string
          years_of_experience: number | null
        }
        Insert: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          industry?: string | null
          job_title?: string | null
          last_name?: string | null
          openai_vector_store_id?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
          years_of_experience?: number | null
        }
        Update: {
          avatar_url?: string | null
          company?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          full_name?: string | null
          id?: string
          industry?: string | null
          job_title?: string | null
          last_name?: string | null
          openai_vector_store_id?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
          years_of_experience?: number | null
        }
        Relationships: []
      }
      programs: {
        Row: {
          code: string | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          code?: string | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          updated_at?: string | null
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
      project_form_data: {
        Row: {
          ai_populated_fields: string[] | null
          created_at: string | null
          field_values: Json | null
          form_id: string
          id: string
          overflow_context: Json | null
          phase_id: string
          project_id: string
          task_id: string
          updated_at: string | null
          user_id: string
          version: number | null
        }
        Insert: {
          ai_populated_fields?: string[] | null
          created_at?: string | null
          field_values?: Json | null
          form_id: string
          id?: string
          overflow_context?: Json | null
          phase_id: string
          project_id: string
          task_id: string
          updated_at?: string | null
          user_id: string
          version?: number | null
        }
        Update: {
          ai_populated_fields?: string[] | null
          created_at?: string | null
          field_values?: Json | null
          form_id?: string
          id?: string
          overflow_context?: Json | null
          phase_id?: string
          project_id?: string
          task_id?: string
          updated_at?: string | null
          user_id?: string
          version?: number | null
        }
        Relationships: []
      }
      public_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
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
      session_material_links: {
        Row: {
          created_at: string
          id: string
          linked_at: string
          material_id: string
          schedule_session_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          linked_at?: string
          material_id: string
          schedule_session_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          linked_at?: string
          material_id?: string
          schedule_session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_material_links_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "course_materials"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_material_links_schedule_session_id_fkey"
            columns: ["schedule_session_id"]
            isOneToOne: false
            referencedRelation: "class_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      session_notes: {
        Row: {
          content: string
          id: string
          linked_segment_id: string | null
          markdown_formatted: boolean | null
          session_id: string
          tags: string[] | null
          timestamp: string
          user_id: string
        }
        Insert: {
          content: string
          id?: string
          linked_segment_id?: string | null
          markdown_formatted?: boolean | null
          session_id: string
          tags?: string[] | null
          timestamp?: string
          user_id: string
        }
        Update: {
          content?: string
          id?: string
          linked_segment_id?: string | null
          markdown_formatted?: boolean | null
          session_id?: string
          tags?: string[] | null
          timestamp?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_notes_linked_segment_id_fkey"
            columns: ["linked_segment_id"]
            isOneToOne: false
            referencedRelation: "lecture_transcripts_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      session_qa: {
        Row: {
          answer: string
          answer_status: string | null
          context_used: Json | null
          course_id: string | null
          created_at: string
          id: string
          question: string
          session_id: string
          sources: Json | null
          user_id: string
        }
        Insert: {
          answer: string
          answer_status?: string | null
          context_used?: Json | null
          course_id?: string | null
          created_at?: string
          id?: string
          question: string
          session_id: string
          sources?: Json | null
          user_id: string
        }
        Update: {
          answer?: string
          answer_status?: string | null
          context_used?: Json | null
          course_id?: string | null
          created_at?: string
          id?: string
          question?: string
          session_id?: string
          sources?: Json | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_qa_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_qa_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "class_schedules"
            referencedColumns: ["id"]
          },
        ]
      }
      slide_annotations: {
        Row: {
          created_at: string
          id: string
          material_id: string
          note_text: string
          page_number: number
          slide_number: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          material_id: string
          note_text: string
          page_number: number
          slide_number?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          material_id?: string
          note_text?: string
          page_number?: number
          slide_number?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "slide_annotations_material_id_fkey"
            columns: ["material_id"]
            isOneToOne: false
            referencedRelation: "course_materials"
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
        Relationships: [
          {
            foreignKeyName: "sync_config_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
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
        Relationships: [
          {
            foreignKeyName: "sync_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["user_id"]
          },
        ]
      }
      task_checklist_items: {
        Row: {
          created_at: string
          id: string
          is_completed: boolean
          position: number
          task_id: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_completed?: boolean
          position?: number
          task_id: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_completed?: boolean
          position?: number
          task_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
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
          scheduling_context: Json | null
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
          scheduling_context?: Json | null
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
          scheduling_context?: Json | null
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
      user_scheduling_prefs: {
        Row: {
          assistant_extensions: string | null
          auto_greeting_timeout: number | null
          config: Json
          core_instructions: string | null
          created_at: string
          custom_voices: Json | null
          elevenlabs_voice_id: string | null
          id: string
          openai_voice: string | null
          realtime_extensions: string | null
          scheduled_calls: Json | null
          timezone: string | null
          tts_provider: string | null
          updated_at: string
          user_id: string
          voice_preference: string | null
        }
        Insert: {
          assistant_extensions?: string | null
          auto_greeting_timeout?: number | null
          config?: Json
          core_instructions?: string | null
          created_at?: string
          custom_voices?: Json | null
          elevenlabs_voice_id?: string | null
          id?: string
          openai_voice?: string | null
          realtime_extensions?: string | null
          scheduled_calls?: Json | null
          timezone?: string | null
          tts_provider?: string | null
          updated_at?: string
          user_id: string
          voice_preference?: string | null
        }
        Update: {
          assistant_extensions?: string | null
          auto_greeting_timeout?: number | null
          config?: Json
          core_instructions?: string | null
          created_at?: string
          custom_voices?: Json | null
          elevenlabs_voice_id?: string | null
          id?: string
          openai_voice?: string | null
          realtime_extensions?: string | null
          scheduled_calls?: Json | null
          timezone?: string | null
          tts_provider?: string | null
          updated_at?: string
          user_id?: string
          voice_preference?: string | null
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          ai_sync_mode: string
          case_study_analysis_prompt: string | null
          case_study_attached_files: string[] | null
          created_at: string
          deep_extraction_default: boolean
          demo_mode: boolean | null
          discussion_post_reviewer_prompt: string | null
          discussion_post_writer_prompt: string | null
          enable_requirements_review: boolean | null
          essay_reviewer_prompt: string | null
          essay_writer_prompt: string | null
          extraction_attached_files: string[] | null
          id: string
          outline_attached_files: string[] | null
          outline_generation_prompt: string | null
          requirements_extraction_prompt: string | null
          reviewer_attached_files: string[] | null
          updated_at: string
          user_id: string
          voice_preference: string | null
          web_search_enabled: boolean | null
          writer_attached_files: string[] | null
        }
        Insert: {
          ai_sync_mode?: string
          case_study_analysis_prompt?: string | null
          case_study_attached_files?: string[] | null
          created_at?: string
          deep_extraction_default?: boolean
          demo_mode?: boolean | null
          discussion_post_reviewer_prompt?: string | null
          discussion_post_writer_prompt?: string | null
          enable_requirements_review?: boolean | null
          essay_reviewer_prompt?: string | null
          essay_writer_prompt?: string | null
          extraction_attached_files?: string[] | null
          id?: string
          outline_attached_files?: string[] | null
          outline_generation_prompt?: string | null
          requirements_extraction_prompt?: string | null
          reviewer_attached_files?: string[] | null
          updated_at?: string
          user_id: string
          voice_preference?: string | null
          web_search_enabled?: boolean | null
          writer_attached_files?: string[] | null
        }
        Update: {
          ai_sync_mode?: string
          case_study_analysis_prompt?: string | null
          case_study_attached_files?: string[] | null
          created_at?: string
          deep_extraction_default?: boolean
          demo_mode?: boolean | null
          discussion_post_reviewer_prompt?: string | null
          discussion_post_writer_prompt?: string | null
          enable_requirements_review?: boolean | null
          essay_reviewer_prompt?: string | null
          essay_writer_prompt?: string | null
          extraction_attached_files?: string[] | null
          id?: string
          outline_attached_files?: string[] | null
          outline_generation_prompt?: string | null
          requirements_extraction_prompt?: string | null
          reviewer_attached_files?: string[] | null
          updated_at?: string
          user_id?: string
          voice_preference?: string | null
          web_search_enabled?: boolean | null
          writer_attached_files?: string[] | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_profile_access_rate_limit: {
        Args: { max_requests?: number; window_minutes?: number }
        Returns: boolean
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
        SetofOptions: {
          from: "*"
          to: "scheduled_notifications"
          isOneToOne: false
          isSetofReturn: true
        }
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
        Args: never
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
        Args: never
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
      get_current_user_profile: {
        Args: never
        Returns: {
          avatar_url: string
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string
          updated_at: string
          user_id: string
        }[]
      }
      get_current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_masked_profiles: {
        Args: never
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
      get_office365_connection_safe: {
        Args: never
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
      get_office365_connection_secure: {
        Args: never
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
      insert_calendar_connection_for_user: {
        Args: {
          _access_token: string
          _expires_at?: string
          _provider: string
          _provider_account_email: string
          _provider_account_id: string
          _refresh_token?: string
          _scope?: string
          _user_id: string
        }
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
      migrate_oauth_tokens: { Args: never; Returns: Json }
      revoke_calendar_connection: {
        Args: { _connection_id: string }
        Returns: boolean
      }
      revoke_office365_connection: {
        Args: { _connection_id: string }
        Returns: boolean
      }
      schedule_next_call: {
        Args: {
          p_call_context: string
          p_call_id: string
          p_call_name: string
          p_call_time: string
          p_timezone?: string
          p_user_id: string
        }
        Returns: string
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
      update_office365_connection_tokens: {
        Args: {
          _access_token: string
          _connection_id: string
          _expires_at?: string
          _refresh_token?: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "user"
      learning_type:
        | "key_term"
        | "definition"
        | "concept"
        | "framework"
        | "formula"
        | "case_study"
        | "objective"
        | "question"
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
      learning_type: [
        "key_term",
        "definition",
        "concept",
        "framework",
        "formula",
        "case_study",
        "objective",
        "question",
      ],
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
