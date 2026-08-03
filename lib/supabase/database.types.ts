export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      capabilities: {
        Row: {
          created_at: string;
          key: string;
          label: string;
        };
        Insert: {
          created_at?: string;
          key: string;
          label: string;
        };
        Update: {
          created_at?: string;
          key?: string;
          label?: string;
        };
        Relationships: [];
      };
      catalog_import_batches: {
        Row: {
          committed_at: string | null;
          content_hash: string;
          created_at: string;
          created_by: string;
          filename: string;
          id: string;
          invalid_count: number;
          organization_id: string;
          row_count: number;
          status: Database["public"]["Enums"]["catalog_import_status"];
          valid_count: number;
        };
        Insert: {
          committed_at?: string | null;
          content_hash: string;
          created_at?: string;
          created_by: string;
          filename: string;
          id?: string;
          invalid_count: number;
          organization_id: string;
          row_count: number;
          status?: Database["public"]["Enums"]["catalog_import_status"];
          valid_count: number;
        };
        Update: {
          committed_at?: string | null;
          content_hash?: string;
          created_at?: string;
          created_by?: string;
          filename?: string;
          id?: string;
          invalid_count?: number;
          organization_id?: string;
          row_count?: number;
          status?: Database["public"]["Enums"]["catalog_import_status"];
          valid_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "catalog_import_batches_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      catalog_import_rows: {
        Row: {
          batch_id: string;
          created_at: string;
          error_codes: string[];
          error_fields: string[];
          id: string;
          normalized_payload: Json;
          organization_id: string;
          row_number: number;
          status: Database["public"]["Enums"]["catalog_import_row_status"];
        };
        Insert: {
          batch_id: string;
          created_at?: string;
          error_codes?: string[];
          error_fields?: string[];
          id?: string;
          normalized_payload: Json;
          organization_id: string;
          row_number: number;
          status: Database["public"]["Enums"]["catalog_import_row_status"];
        };
        Update: {
          batch_id?: string;
          created_at?: string;
          error_codes?: string[];
          error_fields?: string[];
          id?: string;
          normalized_payload?: Json;
          organization_id?: string;
          row_number?: number;
          status?: Database["public"]["Enums"]["catalog_import_row_status"];
        };
        Relationships: [
          {
            foreignKeyName: "catalog_import_rows_organization_id_batch_id_fkey";
            columns: ["organization_id", "batch_id"];
            isOneToOne: false;
            referencedRelation: "catalog_import_batches";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      command_receipts: {
        Row: {
          actor_user_id: string;
          aggregate_id: string;
          aggregate_type: string;
          command_id: string;
          command_type: string;
          created_at: string;
          id: string;
          organization_id: string;
          request_hash: string;
          result: Json;
          scope_id: string;
          scope_type: string;
        };
        Insert: {
          actor_user_id: string;
          aggregate_id: string;
          aggregate_type: string;
          command_id: string;
          command_type: string;
          created_at?: string;
          id?: string;
          organization_id: string;
          request_hash: string;
          result: Json;
          scope_id: string;
          scope_type: string;
        };
        Update: {
          actor_user_id?: string;
          aggregate_id?: string;
          aggregate_type?: string;
          command_id?: string;
          command_type?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          request_hash?: string;
          result?: Json;
          scope_id?: string;
          scope_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "command_receipts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      customers: {
        Row: {
          active: boolean;
          billing_address_line1: string;
          billing_address_line2: string;
          billing_city: string;
          billing_country_code: string;
          billing_postal_code: string;
          billing_region: string;
          contact_name: string;
          created_at: string;
          created_by: string;
          email: string;
          id: string;
          locale: string;
          name: string;
          organization_id: string;
          phone: string;
          preferred_currency_code: string;
          tax_identifier: string | null;
          tax_treatment: Database["public"]["Enums"]["tax_treatment"];
          updated_at: string;
          version: number;
        };
        Insert: {
          active?: boolean;
          billing_address_line1?: string;
          billing_address_line2?: string;
          billing_city?: string;
          billing_country_code: string;
          billing_postal_code?: string;
          billing_region?: string;
          contact_name?: string;
          created_at?: string;
          created_by: string;
          email?: string;
          id?: string;
          locale: string;
          name: string;
          organization_id: string;
          phone?: string;
          preferred_currency_code: string;
          tax_identifier?: string | null;
          tax_treatment?: Database["public"]["Enums"]["tax_treatment"];
          updated_at?: string;
          version?: number;
        };
        Update: {
          active?: boolean;
          billing_address_line1?: string;
          billing_address_line2?: string;
          billing_city?: string;
          billing_country_code?: string;
          billing_postal_code?: string;
          billing_region?: string;
          contact_name?: string;
          created_at?: string;
          created_by?: string;
          email?: string;
          id?: string;
          locale?: string;
          name?: string;
          organization_id?: string;
          phone?: string;
          preferred_currency_code?: string;
          tax_identifier?: string | null;
          tax_treatment?: Database["public"]["Enums"]["tax_treatment"];
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "customers_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_memberships: {
        Row: {
          created_at: string;
          id: string;
          organization_id: string;
          role_id: string;
          status: Database["public"]["Enums"]["membership_status"];
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          organization_id: string;
          role_id: string;
          status?: Database["public"]["Enums"]["membership_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          organization_id?: string;
          role_id?: string;
          status?: Database["public"]["Enums"]["membership_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "organization_memberships_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          approval_threshold_bps: number;
          created_at: string;
          created_by: string;
          default_currency_code: string;
          default_locale: string;
          id: string;
          name: string;
          seller_address_line1: string | null;
          seller_address_line2: string | null;
          seller_city: string | null;
          seller_contact_email: string | null;
          seller_contact_phone: string | null;
          seller_country_code: string | null;
          seller_legal_name: string | null;
          seller_postal_code: string | null;
          seller_profile_version: number;
          seller_region: string | null;
          seller_tax_identifier: string | null;
          slug: string;
          timezone: string;
          updated_at: string;
          version: number;
        };
        Insert: {
          approval_threshold_bps?: number;
          created_at?: string;
          created_by: string;
          default_currency_code?: string;
          default_locale?: string;
          id?: string;
          name: string;
          seller_address_line1?: string | null;
          seller_address_line2?: string | null;
          seller_city?: string | null;
          seller_contact_email?: string | null;
          seller_contact_phone?: string | null;
          seller_country_code?: string | null;
          seller_legal_name?: string | null;
          seller_postal_code?: string | null;
          seller_profile_version?: number;
          seller_region?: string | null;
          seller_tax_identifier?: string | null;
          slug: string;
          timezone?: string;
          updated_at?: string;
          version?: number;
        };
        Update: {
          approval_threshold_bps?: number;
          created_at?: string;
          created_by?: string;
          default_currency_code?: string;
          default_locale?: string;
          id?: string;
          name?: string;
          seller_address_line1?: string | null;
          seller_address_line2?: string | null;
          seller_city?: string | null;
          seller_contact_email?: string | null;
          seller_contact_phone?: string | null;
          seller_country_code?: string | null;
          seller_legal_name?: string | null;
          seller_postal_code?: string | null;
          seller_profile_version?: number;
          seller_region?: string | null;
          seller_tax_identifier?: string | null;
          slug?: string;
          timezone?: string;
          updated_at?: string;
          version?: number;
        };
        Relationships: [];
      };
      products: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string;
          currency_code: string;
          description: string;
          id: string;
          organization_id: string;
          quantity_precision: number;
          sku: string;
          tax_profile_id: string;
          unit_code: Database["public"]["Enums"]["unit_code"];
          unit_price_minor: number;
          updated_at: string;
          version: number;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by: string;
          currency_code: string;
          description: string;
          id?: string;
          organization_id: string;
          quantity_precision: number;
          sku: string;
          tax_profile_id: string;
          unit_code: Database["public"]["Enums"]["unit_code"];
          unit_price_minor: number;
          updated_at?: string;
          version?: number;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string;
          currency_code?: string;
          description?: string;
          id?: string;
          organization_id?: string;
          quantity_precision?: number;
          sku?: string;
          tax_profile_id?: string;
          unit_code?: Database["public"]["Enums"]["unit_code"];
          unit_price_minor?: number;
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "products_organization_id_tax_profile_id_fkey";
            columns: ["organization_id", "tax_profile_id"];
            isOneToOne: false;
            referencedRelation: "tax_profiles";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          default_locale: string;
          display_name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          default_locale?: string;
          display_name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          default_locale?: string;
          display_name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      quote_activity: {
        Row: {
          actor_name_snapshot: string;
          actor_role_snapshot: string;
          actor_source: Database["public"]["Enums"]["quote_activity_source"];
          actor_user_id: string | null;
          created_at: string;
          event_type: string;
          id: string;
          message: string;
          organization_id: string;
          quote_id: string;
          safe_metadata: Json;
        };
        Insert: {
          actor_name_snapshot: string;
          actor_role_snapshot: string;
          actor_source: Database["public"]["Enums"]["quote_activity_source"];
          actor_user_id?: string | null;
          created_at?: string;
          event_type: string;
          id?: string;
          message: string;
          organization_id: string;
          quote_id: string;
          safe_metadata?: Json;
        };
        Update: {
          actor_name_snapshot?: string;
          actor_role_snapshot?: string;
          actor_source?: Database["public"]["Enums"]["quote_activity_source"];
          actor_user_id?: string | null;
          created_at?: string;
          event_type?: string;
          id?: string;
          message?: string;
          organization_id?: string;
          quote_id?: string;
          safe_metadata?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "quote_activity_organization_id_quote_id_fkey";
            columns: ["organization_id", "quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      quote_charges: {
        Row: {
          amount_minor: number;
          charge_total_minor: number;
          charge_type: Database["public"]["Enums"]["quote_charge_type"];
          created_at: string;
          currency_code: string;
          description_snapshot: string;
          discount_applies: boolean;
          discount_minor: number;
          id: string;
          net_minor: number;
          organization_id: string;
          position: number;
          quote_id: string;
          tax_bps_snapshot: number;
          tax_code_snapshot: string;
          tax_minor: number;
          tax_price_basis_snapshot: Database["public"]["Enums"]["tax_price_basis"];
          tax_treatment_snapshot: Database["public"]["Enums"]["tax_treatment"];
          updated_at: string;
        };
        Insert: {
          amount_minor: number;
          charge_total_minor: number;
          charge_type: Database["public"]["Enums"]["quote_charge_type"];
          created_at?: string;
          currency_code: string;
          description_snapshot: string;
          discount_applies?: boolean;
          discount_minor: number;
          id?: string;
          net_minor: number;
          organization_id: string;
          position: number;
          quote_id: string;
          tax_bps_snapshot: number;
          tax_code_snapshot: string;
          tax_minor: number;
          tax_price_basis_snapshot: Database["public"]["Enums"]["tax_price_basis"];
          tax_treatment_snapshot: Database["public"]["Enums"]["tax_treatment"];
          updated_at?: string;
        };
        Update: {
          amount_minor?: number;
          charge_total_minor?: number;
          charge_type?: Database["public"]["Enums"]["quote_charge_type"];
          created_at?: string;
          currency_code?: string;
          description_snapshot?: string;
          discount_applies?: boolean;
          discount_minor?: number;
          id?: string;
          net_minor?: number;
          organization_id?: string;
          position?: number;
          quote_id?: string;
          tax_bps_snapshot?: number;
          tax_code_snapshot?: string;
          tax_minor?: number;
          tax_price_basis_snapshot?: Database["public"]["Enums"]["tax_price_basis"];
          tax_treatment_snapshot?: Database["public"]["Enums"]["tax_treatment"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quote_charges_organization_id_quote_id_fkey";
            columns: ["organization_id", "quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      quote_items: {
        Row: {
          base_minor: number;
          created_at: string;
          currency_code: string;
          description_snapshot: string;
          discount_minor: number;
          id: string;
          line_total_minor: number;
          net_minor: number;
          organization_id: string;
          position: number;
          product_id: string | null;
          quantity_precision_snapshot: number;
          quantity_scale: number;
          quantity_scaled: number;
          quote_id: string;
          sku_snapshot: string;
          tax_bps_snapshot: number;
          tax_code_snapshot: string;
          tax_minor: number;
          tax_price_basis_snapshot: Database["public"]["Enums"]["tax_price_basis"];
          tax_treatment_snapshot: Database["public"]["Enums"]["tax_treatment"];
          unit_code_snapshot: Database["public"]["Enums"]["unit_code"];
          unit_price_minor_snapshot: number;
          updated_at: string;
        };
        Insert: {
          base_minor: number;
          created_at?: string;
          currency_code: string;
          description_snapshot: string;
          discount_minor: number;
          id?: string;
          line_total_minor: number;
          net_minor: number;
          organization_id: string;
          position: number;
          product_id?: string | null;
          quantity_precision_snapshot: number;
          quantity_scale: number;
          quantity_scaled: number;
          quote_id: string;
          sku_snapshot: string;
          tax_bps_snapshot: number;
          tax_code_snapshot: string;
          tax_minor: number;
          tax_price_basis_snapshot: Database["public"]["Enums"]["tax_price_basis"];
          tax_treatment_snapshot: Database["public"]["Enums"]["tax_treatment"];
          unit_code_snapshot: Database["public"]["Enums"]["unit_code"];
          unit_price_minor_snapshot: number;
          updated_at?: string;
        };
        Update: {
          base_minor?: number;
          created_at?: string;
          currency_code?: string;
          description_snapshot?: string;
          discount_minor?: number;
          id?: string;
          line_total_minor?: number;
          net_minor?: number;
          organization_id?: string;
          position?: number;
          product_id?: string | null;
          quantity_precision_snapshot?: number;
          quantity_scale?: number;
          quantity_scaled?: number;
          quote_id?: string;
          sku_snapshot?: string;
          tax_bps_snapshot?: number;
          tax_code_snapshot?: string;
          tax_minor?: number;
          tax_price_basis_snapshot?: Database["public"]["Enums"]["tax_price_basis"];
          tax_treatment_snapshot?: Database["public"]["Enums"]["tax_treatment"];
          unit_code_snapshot?: Database["public"]["Enums"]["unit_code"];
          unit_price_minor_snapshot?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quote_items_organization_id_product_id_fkey";
            columns: ["organization_id", "product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "quote_items_organization_id_quote_id_fkey";
            columns: ["organization_id", "quote_id"];
            isOneToOne: false;
            referencedRelation: "quotes";
            referencedColumns: ["organization_id", "id"];
          },
        ];
      };
      quote_sequences: {
        Row: {
          last_value: number;
          organization_id: string;
          sequence_year: number;
        };
        Insert: {
          last_value: number;
          organization_id: string;
          sequence_year: number;
        };
        Update: {
          last_value?: number;
          organization_id?: string;
          sequence_year?: number;
        };
        Relationships: [
          {
            foreignKeyName: "quote_sequences_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      quotes: {
        Row: {
          approval_threshold_bps_snapshot: number | null;
          approved_at: string | null;
          approved_by: string | null;
          billing_address_line1_snapshot: string | null;
          billing_address_line2_snapshot: string | null;
          billing_city_snapshot: string | null;
          billing_country_code_snapshot: string | null;
          billing_postal_code_snapshot: string | null;
          billing_region_snapshot: string | null;
          charge_net_minor: number;
          charge_tax_minor: number;
          charges_minor: number | null;
          contact_name_snapshot: string | null;
          created_at: string;
          created_by: string;
          currency_code: string;
          customer_id: string;
          customer_name_snapshot: string | null;
          customer_tax_treatment: Database["public"]["Enums"]["tax_treatment"];
          discount_bps: number;
          discount_minor: number;
          email_snapshot: string | null;
          id: string;
          issue_date: string;
          issued_at: string | null;
          issued_by: string | null;
          item_tax_minor: number;
          locale: string;
          notes: string;
          number: string;
          organization_id: string;
          rejected_at: string | null;
          rejected_by: string | null;
          rejected_reason: string | null;
          seller_address_line1_snapshot: string | null;
          seller_address_line2_snapshot: string | null;
          seller_city_snapshot: string | null;
          seller_contact_email_snapshot: string | null;
          seller_contact_phone_snapshot: string | null;
          seller_country_code_snapshot: string | null;
          seller_legal_name_snapshot: string | null;
          seller_postal_code_snapshot: string | null;
          seller_region_snapshot: string | null;
          seller_tax_identifier_snapshot: string | null;
          state: Database["public"]["Enums"]["quote_state"];
          submitted_at: string | null;
          submitted_by: string | null;
          subtotal_minor: number;
          tax_identifier_snapshot: string | null;
          tax_label: string;
          tax_minor: number | null;
          tax_mode: Database["public"]["Enums"]["tax_price_basis"];
          total_minor: number;
          updated_at: string;
          valid_until: string;
          version: number;
        };
        Insert: {
          approval_threshold_bps_snapshot?: number | null;
          approved_at?: string | null;
          approved_by?: string | null;
          billing_address_line1_snapshot?: string | null;
          billing_address_line2_snapshot?: string | null;
          billing_city_snapshot?: string | null;
          billing_country_code_snapshot?: string | null;
          billing_postal_code_snapshot?: string | null;
          billing_region_snapshot?: string | null;
          charge_net_minor?: number;
          charge_tax_minor?: number;
          charges_minor?: number | null;
          contact_name_snapshot?: string | null;
          created_at?: string;
          created_by: string;
          currency_code: string;
          customer_id: string;
          customer_name_snapshot?: string | null;
          customer_tax_treatment: Database["public"]["Enums"]["tax_treatment"];
          discount_bps?: number;
          discount_minor?: number;
          email_snapshot?: string | null;
          id?: string;
          issue_date: string;
          issued_at?: string | null;
          issued_by?: string | null;
          item_tax_minor?: number;
          locale: string;
          notes?: string;
          number: string;
          organization_id: string;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejected_reason?: string | null;
          seller_address_line1_snapshot?: string | null;
          seller_address_line2_snapshot?: string | null;
          seller_city_snapshot?: string | null;
          seller_contact_email_snapshot?: string | null;
          seller_contact_phone_snapshot?: string | null;
          seller_country_code_snapshot?: string | null;
          seller_legal_name_snapshot?: string | null;
          seller_postal_code_snapshot?: string | null;
          seller_region_snapshot?: string | null;
          seller_tax_identifier_snapshot?: string | null;
          state?: Database["public"]["Enums"]["quote_state"];
          submitted_at?: string | null;
          submitted_by?: string | null;
          subtotal_minor?: number;
          tax_identifier_snapshot?: string | null;
          tax_label: string;
          tax_minor?: number | null;
          tax_mode: Database["public"]["Enums"]["tax_price_basis"];
          total_minor?: number;
          updated_at?: string;
          valid_until: string;
          version?: number;
        };
        Update: {
          approval_threshold_bps_snapshot?: number | null;
          approved_at?: string | null;
          approved_by?: string | null;
          billing_address_line1_snapshot?: string | null;
          billing_address_line2_snapshot?: string | null;
          billing_city_snapshot?: string | null;
          billing_country_code_snapshot?: string | null;
          billing_postal_code_snapshot?: string | null;
          billing_region_snapshot?: string | null;
          charge_net_minor?: number;
          charge_tax_minor?: number;
          charges_minor?: number | null;
          contact_name_snapshot?: string | null;
          created_at?: string;
          created_by?: string;
          currency_code?: string;
          customer_id?: string;
          customer_name_snapshot?: string | null;
          customer_tax_treatment?: Database["public"]["Enums"]["tax_treatment"];
          discount_bps?: number;
          discount_minor?: number;
          email_snapshot?: string | null;
          id?: string;
          issue_date?: string;
          issued_at?: string | null;
          issued_by?: string | null;
          item_tax_minor?: number;
          locale?: string;
          notes?: string;
          number?: string;
          organization_id?: string;
          rejected_at?: string | null;
          rejected_by?: string | null;
          rejected_reason?: string | null;
          seller_address_line1_snapshot?: string | null;
          seller_address_line2_snapshot?: string | null;
          seller_city_snapshot?: string | null;
          seller_contact_email_snapshot?: string | null;
          seller_contact_phone_snapshot?: string | null;
          seller_country_code_snapshot?: string | null;
          seller_legal_name_snapshot?: string | null;
          seller_postal_code_snapshot?: string | null;
          seller_region_snapshot?: string | null;
          seller_tax_identifier_snapshot?: string | null;
          state?: Database["public"]["Enums"]["quote_state"];
          submitted_at?: string | null;
          submitted_by?: string | null;
          subtotal_minor?: number;
          tax_identifier_snapshot?: string | null;
          tax_label?: string;
          tax_minor?: number | null;
          tax_mode?: Database["public"]["Enums"]["tax_price_basis"];
          total_minor?: number;
          updated_at?: string;
          valid_until?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "quotes_organization_id_customer_id_fkey";
            columns: ["organization_id", "customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["organization_id", "id"];
          },
          {
            foreignKeyName: "quotes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      role_capabilities: {
        Row: {
          capability_key: string;
          created_at: string;
          role_id: string;
        };
        Insert: {
          capability_key: string;
          created_at?: string;
          role_id: string;
        };
        Update: {
          capability_key?: string;
          created_at?: string;
          role_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "role_capabilities_capability_key_fkey";
            columns: ["capability_key"];
            isOneToOne: false;
            referencedRelation: "capabilities";
            referencedColumns: ["key"];
          },
          {
            foreignKeyName: "role_capabilities_role_id_fkey";
            columns: ["role_id"];
            isOneToOne: false;
            referencedRelation: "roles";
            referencedColumns: ["id"];
          },
        ];
      };
      roles: {
        Row: {
          created_at: string;
          id: string;
          is_system: boolean;
          key: string;
          label: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_system?: boolean;
          key: string;
          label: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_system?: boolean;
          key?: string;
          label?: string;
        };
        Relationships: [];
      };
      tax_profiles: {
        Row: {
          active: boolean;
          code: string;
          created_at: string;
          created_by: string;
          id: string;
          jurisdiction_country_code: string | null;
          label: string;
          organization_id: string;
          price_basis: Database["public"]["Enums"]["tax_price_basis"];
          rate_bps: number;
          treatment: Database["public"]["Enums"]["tax_treatment"];
          updated_at: string;
          version: number;
        };
        Insert: {
          active?: boolean;
          code: string;
          created_at?: string;
          created_by: string;
          id?: string;
          jurisdiction_country_code?: string | null;
          label: string;
          organization_id: string;
          price_basis: Database["public"]["Enums"]["tax_price_basis"];
          rate_bps: number;
          treatment: Database["public"]["Enums"]["tax_treatment"];
          updated_at?: string;
          version?: number;
        };
        Update: {
          active?: boolean;
          code?: string;
          created_at?: string;
          created_by?: string;
          id?: string;
          jurisdiction_country_code?: string | null;
          label?: string;
          organization_id?: string;
          price_basis?: Database["public"]["Enums"]["tax_price_basis"];
          rate_bps?: number;
          treatment?: Database["public"]["Enums"]["tax_treatment"];
          updated_at?: string;
          version?: number;
        };
        Relationships: [
          {
            foreignKeyName: "tax_profiles_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      approve_quote: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_quote_id: string;
        };
        Returns: Json;
      };
      approve_quote_c0_impl: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_quote_id: string;
        };
        Returns: Json;
      };
      archive_customer: {
        Args: {
          p_command_id: string;
          p_customer_id: string;
          p_expected_version: number;
        };
        Returns: Json;
      };
      archive_product: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_product_id: string;
        };
        Returns: Json;
      };
      archive_tax_profile:
        | {
            Args: {
              p_command_id: string;
              p_expected_version: number;
              p_tax_profile_id: string;
            };
            Returns: Json;
          }
        | {
            Args: {
              p_command_id: string;
              p_expected_version: number;
              p_replacement_tax_profile_id: string;
              p_tax_profile_id: string;
            };
            Returns: Json;
          };
      calculate_quote_payload: { Args: { p_payload: Json }; Returns: Json };
      calculate_quote_payload_c2_legacy_impl: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      calculate_quote_payloads: { Args: { p_payloads: Json }; Returns: Json };
      command_receipt_replay: {
        Args: {
          p_aggregate_id: string;
          p_aggregate_type: string;
          p_command_id: string;
          p_command_type: string;
          p_request: Json;
          p_scope_id: string;
          p_scope_type: string;
        };
        Returns: Json;
      };
      command_request_hash: { Args: { p_request: Json }; Returns: string };
      commit_catalog_import: {
        Args: {
          p_allow_partial: boolean;
          p_batch_id: string;
          p_command_id: string;
        };
        Returns: Json;
      };
      commit_catalog_import_c0_impl: {
        Args: {
          p_allow_partial: boolean;
          p_batch_id: string;
          p_command_id: string;
        };
        Returns: Json;
      };
      create_customer: {
        Args: {
          p_command_id: string;
          p_organization_id: string;
          p_payload: Json;
        };
        Returns: Json;
      };
      create_organization: {
        Args: { p_command_id: string; p_name: string; p_slug: string };
        Returns: Json;
      };
      create_organization_c0_impl: {
        Args: { p_command_id: string; p_name: string; p_slug: string };
        Returns: Json;
      };
      create_product: {
        Args: {
          p_command_id: string;
          p_organization_id: string;
          p_payload: Json;
        };
        Returns: Json;
      };
      create_quote_draft: {
        Args: {
          p_command_id: string;
          p_currency_code: string;
          p_customer_id: string;
          p_issue_date: string;
          p_locale: string;
          p_organization_id: string;
          p_tax_label: string;
          p_tax_mode: Database["public"]["Enums"]["tax_price_basis"];
          p_valid_until: string;
        };
        Returns: Json;
      };
      create_quote_draft_c0_impl: {
        Args: {
          p_command_id: string;
          p_currency_code: string;
          p_customer_id: string;
          p_issue_date: string;
          p_locale: string;
          p_organization_id: string;
          p_tax_label: string;
          p_tax_mode: Database["public"]["Enums"]["tax_price_basis"];
          p_valid_until: string;
        };
        Returns: Json;
      };
      create_tax_profile: {
        Args: {
          p_command_id: string;
          p_organization_id: string;
          p_payload: Json;
        };
        Returns: Json;
      };
      execute_scoped_quote_command: {
        Args: {
          p_action: string;
          p_command_id: string;
          p_expected_version: number;
          p_quote_id: string;
          p_reason?: string;
        };
        Returns: Json;
      };
      has_org_capability: {
        Args: { p_capability_key: string; p_organization_id: string };
        Returns: boolean;
      };
      is_active_org_member: {
        Args: { p_organization_id: string };
        Returns: boolean;
      };
      is_supported_currency: {
        Args: { p_currency_code: string };
        Returns: boolean;
      };
      is_valid_iana_timezone: {
        Args: { p_timezone: string };
        Returns: boolean;
      };
      issue_quote: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_quote_id: string;
        };
        Returns: Json;
      };
      issue_quote_c0_impl: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_quote_id: string;
        };
        Returns: Json;
      };
      next_quote_number: {
        Args: { p_issue_date: string; p_organization_id: string };
        Returns: string;
      };
      normalize_customer_payload: { Args: { p_payload: Json }; Returns: Json };
      normalize_organization_settings_payload: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      normalize_product_payload: {
        Args: { p_organization_id: string; p_payload: Json };
        Returns: Json;
      };
      normalize_tax_profile_payload: {
        Args: { p_payload: Json };
        Returns: Json;
      };
      organization_local_date: {
        Args: { p_at: string; p_organization_id: string };
        Returns: string;
      };
      prepare_catalog_import: {
        Args: { p_filename: string; p_organization_id: string; p_rows: Json };
        Returns: Json;
      };
      quote_actor: { Args: { p_organization_id: string }; Returns: Json };
      quote_draft_projection: {
        Args: { p_organization_id: string; p_quote_id: string };
        Returns: Json;
      };
      quote_effective_state: {
        Args: {
          p_at: string;
          p_state: Database["public"]["Enums"]["quote_state"];
          p_timezone: string;
          p_valid_until: string;
        };
        Returns: Database["public"]["Enums"]["quote_state"];
      };
      recalculate_quote: {
        Args: { p_organization_id: string; p_quote_id: string };
        Returns: Json;
      };
      record_organization_command: {
        Args: {
          p_actor_user_id: string;
          p_aggregate_id: string;
          p_aggregate_type: string;
          p_command_id: string;
          p_command_type: string;
          p_organization_id: string;
          p_request: Json;
          p_result: Json;
        };
        Returns: undefined;
      };
      refresh_quote_line_from_catalog: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_line_id: string;
          p_quote_id: string;
        };
        Returns: Json;
      };
      reject_quote: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_quote_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
      reject_quote_c0_impl: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_quote_id: string;
          p_reason: string;
        };
        Returns: Json;
      };
      round_nonnegative_ratio: {
        Args: { p_divisor: number; p_multiplier: number; p_value: number };
        Returns: number;
      };
      save_quote_draft: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_payload: Json;
          p_quote_id: string;
        };
        Returns: Json;
      };
      save_quote_draft_c1_payload_impl: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_payload: Json;
          p_quote_id: string;
        };
        Returns: Json;
      };
      search_customers: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_organization_id: string;
          p_query: string;
          p_state: string;
        };
        Returns: {
          active: boolean;
          billing_address_line1: string;
          billing_address_line2: string;
          billing_city: string;
          billing_country_code: string;
          billing_postal_code: string;
          billing_region: string;
          contact_name: string;
          email: string;
          id: string;
          locale: string;
          name: string;
          phone: string;
          preferred_currency_code: string;
          tax_identifier: string;
          tax_treatment: Database["public"]["Enums"]["tax_treatment"];
          version: number;
        }[];
      };
      search_products: {
        Args: {
          p_limit: number;
          p_offset: number;
          p_organization_id: string;
          p_query: string;
          p_state: string;
        };
        Returns: {
          active: boolean;
          currency_code: string;
          description: string;
          id: string;
          quantity_precision: number;
          sku: string;
          tax_code: string;
          tax_label: string;
          tax_profile_id: string;
          unit_code: Database["public"]["Enums"]["unit_code"];
          unit_price_minor: number;
          version: number;
        }[];
      };
      set_command_receipt_context: {
        Args: {
          p_command_id: string;
          p_request: Json;
          p_scope_id: string;
          p_scope_type: string;
        };
        Returns: undefined;
      };
      submit_quote: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_quote_id: string;
        };
        Returns: Json;
      };
      submit_quote_c0_impl: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_quote_id: string;
        };
        Returns: Json;
      };
      update_customer: {
        Args: {
          p_command_id: string;
          p_customer_id: string;
          p_expected_version: number;
          p_payload: Json;
        };
        Returns: Json;
      };
      update_organization_settings: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_organization_id: string;
          p_payload: Json;
        };
        Returns: Json;
      };
      update_product: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_payload: Json;
          p_product_id: string;
        };
        Returns: Json;
      };
      update_tax_profile: {
        Args: {
          p_command_id: string;
          p_expected_version: number;
          p_payload: Json;
          p_tax_profile_id: string;
        };
        Returns: Json;
      };
      validate_quantity: {
        Args: {
          p_precision: number;
          p_quantity_scale: number;
          p_quantity_scaled: number;
          p_unit_code: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      catalog_import_row_status: "valid" | "invalid" | "committed";
      catalog_import_status: "previewed" | "committed" | "rejected";
      membership_status: "active" | "invited" | "suspended";
      quote_activity_source: "signed_user" | "automatic_rule" | "system";
      quote_charge_type:
        | "freight"
        | "shipping"
        | "handling"
        | "insurance"
        | "packaging"
        | "customs_duties"
        | "other";
      quote_state:
        "draft" | "waiting" | "approved" | "rejected" | "issued" | "expired";
      tax_price_basis: "exclusive" | "inclusive";
      tax_treatment: "standard" | "exempt" | "zero_rated" | "reverse_charge";
      unit_code: "EA" | "M" | "KG" | "L" | "BOX";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      catalog_import_row_status: ["valid", "invalid", "committed"],
      catalog_import_status: ["previewed", "committed", "rejected"],
      membership_status: ["active", "invited", "suspended"],
      quote_activity_source: ["signed_user", "automatic_rule", "system"],
      quote_charge_type: [
        "freight",
        "shipping",
        "handling",
        "insurance",
        "packaging",
        "customs_duties",
        "other",
      ],
      quote_state: [
        "draft",
        "waiting",
        "approved",
        "rejected",
        "issued",
        "expired",
      ],
      tax_price_basis: ["exclusive", "inclusive"],
      tax_treatment: ["standard", "exempt", "zero_rated", "reverse_charge"],
      unit_code: ["EA", "M", "KG", "L", "BOX"],
    },
  },
} as const;
