export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_profiles: {
        Row: {
          active: boolean
          created_at: string
          display_name: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          display_name: string
          role?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          display_name?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      compradores: {
        Row: {
          acesso_claim: string | null
          acesso_disparo_id: string | null
          acesso_enviado_em: string | null
          acesso_erro: string | null
          acesso_status: string | null
          acesso_template_id: string | null
          acesso_tentativas: number
          cidade: string
          created_at: string
          documento: string
          email: string
          email_normalized: string | null
          id: string
          nome: string
          telefone: string
          uf: string
          updated_at: string
          wa_claim: string | null
          wa_disparo_id: string | null
          wa_enviado_em: string | null
          wa_erro: string | null
          wa_status: string | null
          wa_tentativas: number
        }
        Insert: {
          acesso_claim?: string | null
          acesso_disparo_id?: string | null
          acesso_enviado_em?: string | null
          acesso_erro?: string | null
          acesso_status?: string | null
          acesso_template_id?: string | null
          acesso_tentativas?: number
          cidade?: string
          created_at?: string
          documento?: string
          email: string
          email_normalized?: string | null
          id?: string
          nome: string
          telefone?: string
          uf?: string
          updated_at?: string
          wa_claim?: string | null
          wa_disparo_id?: string | null
          wa_enviado_em?: string | null
          wa_erro?: string | null
          wa_status?: string | null
          wa_tentativas?: number
        }
        Update: {
          acesso_claim?: string | null
          acesso_disparo_id?: string | null
          acesso_enviado_em?: string | null
          acesso_erro?: string | null
          acesso_status?: string | null
          acesso_template_id?: string | null
          acesso_tentativas?: number
          cidade?: string
          created_at?: string
          documento?: string
          email?: string
          email_normalized?: string | null
          id?: string
          nome?: string
          telefone?: string
          uf?: string
          updated_at?: string
          wa_claim?: string | null
          wa_disparo_id?: string | null
          wa_enviado_em?: string | null
          wa_erro?: string | null
          wa_status?: string | null
          wa_tentativas?: number
        }
        Relationships: []
      }
      cortesias: {
        Row: {
          anfitriao: string
          ativo: boolean
          comprador_id: string | null
          created_at: string
          id: string
          limite: number
          tipo_ingresso: string
          token: string
          updated_at: string
          usados: number
        }
        Insert: {
          anfitriao: string
          ativo?: boolean
          comprador_id?: string | null
          created_at?: string
          id?: string
          limite?: number
          tipo_ingresso?: string
          token: string
          updated_at?: string
          usados?: number
        }
        Update: {
          anfitriao?: string
          ativo?: boolean
          comprador_id?: string | null
          created_at?: string
          id?: string
          limite?: number
          tipo_ingresso?: string
          token?: string
          updated_at?: string
          usados?: number
        }
        Relationships: [
          {
            foreignKeyName: "cortesias_comprador_id_fkey"
            columns: ["comprador_id"]
            isOneToOne: false
            referencedRelation: "compradores"
            referencedColumns: ["id"]
          },
        ]
      }
      cron_health: {
        Row: {
          created_at: string
          email_last_run: string | null
          id: string
          last_run: string
          metadata: Json
          updated_at: string
          whatsapp_last_run: string | null
        }
        Insert: {
          created_at?: string
          email_last_run?: string | null
          id?: string
          last_run?: string
          metadata?: Json
          updated_at?: string
          whatsapp_last_run?: string | null
        }
        Update: {
          created_at?: string
          email_last_run?: string | null
          id?: string
          last_run?: string
          metadata?: Json
          updated_at?: string
          whatsapp_last_run?: string | null
        }
        Relationships: []
      }
      disparos: {
        Row: {
          audience: string
          cluster: string
          created_at: string
          enviados: number
          erros: number
          id: string
          nome: string
          status: string
          template_id: string
          template_nome: string
          total: number
          updated_at: string
        }
        Insert: {
          audience?: string
          cluster: string
          created_at?: string
          enviados?: number
          erros?: number
          id?: string
          nome?: string
          status?: string
          template_id: string
          template_nome?: string
          total?: number
          updated_at?: string
        }
        Update: {
          audience?: string
          cluster?: string
          created_at?: string
          enviados?: number
          erros?: number
          id?: string
          nome?: string
          status?: string
          template_id?: string
          template_nome?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      disparos_wa: {
        Row: {
          cluster: string
          created_at: string
          enviados: number
          erros: number
          flow: string
          flow_nome: string
          id: string
          mapping: Json
          nome: string
          status: string
          total: number
          updated_at: string
        }
        Insert: {
          cluster: string
          created_at?: string
          enviados?: number
          erros?: number
          flow?: string
          flow_nome?: string
          id?: string
          mapping?: Json
          nome?: string
          status?: string
          total?: number
          updated_at?: string
        }
        Update: {
          cluster?: string
          created_at?: string
          enviados?: number
          erros?: number
          flow?: string
          flow_nome?: string
          id?: string
          mapping?: Json
          nome?: string
          status?: string
          total?: number
          updated_at?: string
        }
        Relationships: []
      }
      envios: {
        Row: {
          claim: string | null
          comprador_id: string | null
          created_at: string
          disparo_id: string
          email: string
          enviado_em: string | null
          erro: string | null
          id: string
          nome: string
          participante_id: string | null
          proxima_tentativa_em: string | null
          status: string
          tentativas: number
          updated_at: string
        }
        Insert: {
          claim?: string | null
          comprador_id?: string | null
          created_at?: string
          disparo_id: string
          email: string
          enviado_em?: string | null
          erro?: string | null
          id?: string
          nome?: string
          participante_id?: string | null
          proxima_tentativa_em?: string | null
          status?: string
          tentativas?: number
          updated_at?: string
        }
        Update: {
          claim?: string | null
          comprador_id?: string | null
          created_at?: string
          disparo_id?: string
          email?: string
          enviado_em?: string | null
          erro?: string | null
          id?: string
          nome?: string
          participante_id?: string | null
          proxima_tentativa_em?: string | null
          status?: string
          tentativas?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "envios_comprador_id_fkey"
            columns: ["comprador_id"]
            isOneToOne: false
            referencedRelation: "compradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_disparo_id_fkey"
            columns: ["disparo_id"]
            isOneToOne: false
            referencedRelation: "disparos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "envios_participante_id_fkey"
            columns: ["participante_id"]
            isOneToOne: false
            referencedRelation: "participantes"
            referencedColumns: ["id"]
          },
        ]
      }
      ingressos: {
        Row: {
          comprador_id: string
          cortesia_id: string | null
          created_at: string
          id: string
          inac_id: string | null
          inac_qr: string | null
          origem: string
          participante_id: string | null
          pedido_id: string
          preenchido_em: string | null
          status: string
          status_webhook: string
          tipo_ingresso: string
          updated_at: string
        }
        Insert: {
          comprador_id: string
          cortesia_id?: string | null
          created_at?: string
          id?: string
          inac_id?: string | null
          inac_qr?: string | null
          origem?: string
          participante_id?: string | null
          pedido_id: string
          preenchido_em?: string | null
          status?: string
          status_webhook?: string
          tipo_ingresso?: string
          updated_at?: string
        }
        Update: {
          comprador_id?: string
          cortesia_id?: string | null
          created_at?: string
          id?: string
          inac_id?: string | null
          inac_qr?: string | null
          origem?: string
          participante_id?: string | null
          pedido_id?: string
          preenchido_em?: string | null
          status?: string
          status_webhook?: string
          tipo_ingresso?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingressos_comprador_id_fkey"
            columns: ["comprador_id"]
            isOneToOne: false
            referencedRelation: "compradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingressos_participante_id_fkey"
            columns: ["participante_id"]
            isOneToOne: true
            referencedRelation: "participantes"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_attempts: {
        Row: {
          attempt: number
          created_at: string
          duration_ms: number | null
          error: string | null
          id: number
          idempotency_key: string
          ingresso_id: string | null
          operation: string
          participant_id: string | null
          provider: string
          request_payload: Json
          response_payload: Json | null
          response_status: number | null
          success: boolean
        }
        Insert: {
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: never
          idempotency_key: string
          ingresso_id?: string | null
          operation: string
          participant_id?: string | null
          provider: string
          request_payload?: Json
          response_payload?: Json | null
          response_status?: number | null
          success?: boolean
        }
        Update: {
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          id?: never
          idempotency_key?: string
          ingresso_id?: string | null
          operation?: string
          participant_id?: string | null
          provider?: string
          request_payload?: Json
          response_payload?: Json | null
          response_status?: number | null
          success?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "integration_attempts_ingresso_id_fkey"
            columns: ["ingresso_id"]
            isOneToOne: false
            referencedRelation: "ingressos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_attempts_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "participantes"
            referencedColumns: ["id"]
          },
        ]
      }
      links_participante: {
        Row: {
          created_at: string
          expira_em: string
          id: string
          ingresso_id: string
          token: string
          updated_at: string
          usado: boolean
        }
        Insert: {
          created_at?: string
          expira_em: string
          id?: string
          ingresso_id: string
          token: string
          updated_at?: string
          usado?: boolean
        }
        Update: {
          created_at?: string
          expira_em?: string
          id?: string
          ingresso_id?: string
          token?: string
          updated_at?: string
          usado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "links_participante_ingresso_id_fkey"
            columns: ["ingresso_id"]
            isOneToOne: false
            referencedRelation: "ingressos"
            referencedColumns: ["id"]
          },
        ]
      }
      participantes: {
        Row: {
          acesso_claim: string | null
          acesso_disparo_id: string | null
          acesso_enviado_em: string | null
          acesso_erro: string | null
          acesso_status: string | null
          acesso_template_id: string | null
          acesso_tentativas: number
          areas_ajuda: Json
          cargo: string
          cpf: string
          cpf_normalized: string | null
          created_at: string
          email: string
          email_normalized: string | null
          expectativa_aprendizado: string
          expectativa_experiencia: string
          faturamento_anual: string
          ia_desafio: string
          ia_ferramentas: string
          ia_profundidade: number | null
          ia_uso_diario: number | null
          id: string
          ingresso_id: string
          nicho: string
          nome_completo: string
          nome_empresa: string
          num_funcionarios: string
          profissao: string
          telefone: string
          tem_empresa: boolean | null
          terms_accepted_at: string
          updated_at: string
        }
        Insert: {
          acesso_claim?: string | null
          acesso_disparo_id?: string | null
          acesso_enviado_em?: string | null
          acesso_erro?: string | null
          acesso_status?: string | null
          acesso_template_id?: string | null
          acesso_tentativas?: number
          areas_ajuda?: Json
          cargo?: string
          cpf: string
          cpf_normalized?: string | null
          created_at?: string
          email: string
          email_normalized?: string | null
          expectativa_aprendizado?: string
          expectativa_experiencia?: string
          faturamento_anual?: string
          ia_desafio?: string
          ia_ferramentas?: string
          ia_profundidade?: number | null
          ia_uso_diario?: number | null
          id?: string
          ingresso_id: string
          nicho?: string
          nome_completo: string
          nome_empresa?: string
          num_funcionarios?: string
          profissao?: string
          telefone: string
          tem_empresa?: boolean | null
          terms_accepted_at: string
          updated_at?: string
        }
        Update: {
          acesso_claim?: string | null
          acesso_disparo_id?: string | null
          acesso_enviado_em?: string | null
          acesso_erro?: string | null
          acesso_status?: string | null
          acesso_template_id?: string | null
          acesso_tentativas?: number
          areas_ajuda?: Json
          cargo?: string
          cpf?: string
          cpf_normalized?: string | null
          created_at?: string
          email?: string
          email_normalized?: string | null
          expectativa_aprendizado?: string
          expectativa_experiencia?: string
          faturamento_anual?: string
          ia_desafio?: string
          ia_ferramentas?: string
          ia_profundidade?: number | null
          ia_uso_diario?: number | null
          id?: string
          ingresso_id?: string
          nicho?: string
          nome_completo?: string
          nome_empresa?: string
          num_funcionarios?: string
          profissao?: string
          telefone?: string
          tem_empresa?: boolean | null
          terms_accepted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "participantes_ingresso_id_fkey"
            columns: ["ingresso_id"]
            isOneToOne: true
            referencedRelation: "ingressos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_guru: {
        Row: {
          comprador_id: string | null
          created_at: string
          email: string
          email_status: string
          id: string
          ingressos: number
          payload: Json
          status: string
          transacao_id: string
          updated_at: string
        }
        Insert: {
          comprador_id?: string | null
          created_at?: string
          email?: string
          email_status?: string
          id?: string
          ingressos?: number
          payload?: Json
          status: string
          transacao_id: string
          updated_at?: string
        }
        Update: {
          comprador_id?: string | null
          created_at?: string
          email?: string
          email_status?: string
          id?: string
          ingressos?: number
          payload?: Json
          status?: string
          transacao_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_guru_comprador_id_fkey"
            columns: ["comprador_id"]
            isOneToOne: false
            referencedRelation: "compradores"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_events: {
        Row: {
          applied_at: string | null
          error: string | null
          event_id: string
          operation: string
          payload: Json
          received_at: string
          record_id: string
          source_table: string
          source_updated_at: string
          state: string
        }
        Insert: {
          applied_at?: string | null
          error?: string | null
          event_id: string
          operation: string
          payload?: Json
          received_at?: string
          record_id: string
          source_table: string
          source_updated_at: string
          state?: string
        }
        Update: {
          applied_at?: string | null
          error?: string | null
          event_id?: string
          operation?: string
          payload?: Json
          received_at?: string
          record_id?: string
          source_table?: string
          source_updated_at?: string
          state?: string
        }
        Relationships: []
      }
      sync_tombstones: {
        Row: {
          created_at: string
          event_id: string
          record_id: string
          source_table: string
          source_updated_at: string
        }
        Insert: {
          created_at?: string
          event_id: string
          record_id: string
          source_table: string
          source_updated_at: string
        }
        Update: {
          created_at?: string
          event_id?: string
          record_id?: string
          source_table?: string
          source_updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sync_tombstones_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "sync_events"
            referencedColumns: ["event_id"]
          },
        ]
      }
      system_state: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          last_reconciled_at: string | null
          last_sync_event_at: string | null
          metadata: Json
          mode: string
          pocketbase_writes_blocked: boolean
          singleton: boolean
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          last_reconciled_at?: string | null
          last_sync_event_at?: string | null
          metadata?: Json
          mode?: string
          pocketbase_writes_blocked?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          last_reconciled_at?: string | null
          last_sync_event_at?: string | null
          metadata?: Json
          mode?: string
          pocketbase_writes_blocked?: boolean
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      ticket_operation_claims: {
        Row: {
          actor: string
          completed_at: string | null
          created_at: string
          expected_updated_at: string
          expires_at: string
          id: string
          ingresso_id: string
          operation: string
          payload: Json
          result: Json | null
          state: string
        }
        Insert: {
          actor: string
          completed_at?: string | null
          created_at?: string
          expected_updated_at: string
          expires_at?: string
          id?: string
          ingresso_id: string
          operation: string
          payload?: Json
          result?: Json | null
          state?: string
        }
        Update: {
          actor?: string
          completed_at?: string | null
          created_at?: string
          expected_updated_at?: string
          expires_at?: string
          id?: string
          ingresso_id?: string
          operation?: string
          payload?: Json
          result?: Json | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_operation_claims_ingresso_id_fkey"
            columns: ["ingresso_id"]
            isOneToOne: false
            referencedRelation: "ingressos"
            referencedColumns: ["id"]
          },
        ]
      }
      tokens_acesso: {
        Row: {
          comprador_id: string
          created_at: string
          expira_em: string
          id: string
          token: string
          updated_at: string
          usado: boolean
        }
        Insert: {
          comprador_id: string
          created_at?: string
          expira_em: string
          id?: string
          token: string
          updated_at?: string
          usado?: boolean
        }
        Update: {
          comprador_id?: string
          created_at?: string
          expira_em?: string
          id?: string
          token?: string
          updated_at?: string
          usado?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "tokens_acesso_comprador_id_fkey"
            columns: ["comprador_id"]
            isOneToOne: false
            referencedRelation: "compradores"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks_log: {
        Row: {
          created_at: string
          detalhe: string | null
          evento: string | null
          id: string
          ingresso_id: string | null
          metadata: Json
          method: string | null
          payload: string | null
          response: string | null
          status: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          detalhe?: string | null
          evento?: string | null
          id?: string
          ingresso_id?: string | null
          metadata?: Json
          method?: string | null
          payload?: string | null
          response?: string | null
          status?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          detalhe?: string | null
          evento?: string | null
          id?: string
          ingresso_id?: string | null
          metadata?: Json
          method?: string | null
          payload?: string | null
          response?: string | null
          status?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_log_ingresso_id_fkey"
            columns: ["ingresso_id"]
            isOneToOne: false
            referencedRelation: "ingressos"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      sync_health: {
        Row: {
          failed_events: number | null
          lag_seconds: number | null
          last_applied_at: string | null
          last_sync_event_at: string | null
          mode: string | null
          pending_events: number | null
          pocketbase_writes_blocked: boolean | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_participants_search: {
        Args: {
          p_page?: number
          p_per_page?: number
          p_query?: string
          p_status?: string
          p_type?: string
        }
        Returns: Json
      }
      apply_sync_event: { Args: { p_event: Json }; Returns: Json }
      claim_email_dispatch_batch: {
        Args: { p_limit?: number }
        Returns: {
          claim: string | null
          comprador_id: string | null
          created_at: string
          disparo_id: string
          email: string
          enviado_em: string | null
          erro: string | null
          id: string
          nome: string
          participante_id: string | null
          proxima_tentativa_em: string | null
          status: string
          tentativas: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "envios"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_ticket_operation: {
        Args: {
          p_actor: string
          p_operation: string
          p_payload?: Json
          p_ticket_id: string
        }
        Returns: Json
      }
      claim_whatsapp_dispatch_batch: {
        Args: { p_limit?: number }
        Returns: {
          attempt: number
          buyer_id: string
          dispatch_id: string
          email: string
          flow: string
          mapping: Json
          nome: string
          telefone: string
          token: string
        }[]
      }
      complete_email_dispatch: {
        Args: { p_delivery_id: string; p_error?: string; p_success: boolean }
        Returns: undefined
      }
      complete_ticket_operation: {
        Args: {
          p_claim_id: string
          p_provider_result?: Json
          p_success: boolean
        }
        Returns: Json
      }
      complete_whatsapp_dispatch: {
        Args: { p_buyer_id: string; p_error?: string; p_success: boolean }
        Returns: undefined
      }
      consume_buyer_token: { Args: { p_token: string }; Returns: Json }
      create_admin_ticket: {
        Args: {
          p_buyer_id: string
          p_order_id?: string
          p_origin?: string
          p_ticket_type: string
        }
        Returns: Json
      }
      create_courtesy: {
        Args: { p_host: string; p_limit: number; p_ticket_type: string }
        Returns: Json
      }
      create_participant_link: {
        Args: {
          p_buyer_token: string
          p_expires_at?: string
          p_ticket_id: string
        }
        Returns: Json
      }
      credential_ticket: {
        Args: { p_actor: string; p_payload: Json; p_ticket_id: string }
        Returns: Json
      }
      get_buyer_tickets: { Args: { p_token: string }; Returns: Json }
      get_participant_link: { Args: { p_token: string }; Returns: Json }
      import_buyers_batch: { Args: { p_rows: Json }; Returns: Json }
      process_guru_order: {
        Args: {
          p_buyer: Json
          p_email: string
          p_items: Json
          p_payload: Json
          p_transaction_id: string
        }
        Returns: Json
      }
      register_courtesy: {
        Args: { p_payload: Json; p_token: string }
        Returns: Json
      }
      set_system_mode: {
        Args: {
          p_mode: string
          p_pocketbase_writes_blocked?: boolean
          p_user_id: string
        }
        Returns: Json
      }
      submit_participant: {
        Args: { p_link_token: string; p_payload: Json }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
