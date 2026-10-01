
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "app_settings": {
                  Row: {
                    "description": string | null,"id": string,"key": string,"updated_at": string,"updated_by": string | null,"value": NonNullable<Json>
                  }
                  Insert: {
                    "description"?: string | null,"id"?: string,"key": string,"updated_at"?: string,"updated_by"?: string | null,"value": NonNullable<Json>
                  }
                  Update: {
                    "description"?: string | null,"id"?: string,"key"?: string,"updated_at"?: string,"updated_by"?: string | null,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "app_settings_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_user_id": string | null,"after_data": Json | null,"before_data": Json | null,"created_at": string,"entity_id": string | null,"entity_type": string,"id": string,"reason": string | null
                  }
                  Insert: {
                    "action": string,"actor_user_id"?: string | null,"after_data"?: Json | null,"before_data"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type": string,"id"?: string,"reason"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_user_id"?: string | null,"after_data"?: Json | null,"before_data"?: Json | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string,"id"?: string,"reason"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_logs_actor_user_id_fkey"
      columns: ["actor_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"commission_rules": {
                  Row: {
                    "created_at": string,"effective_from": string,"effective_to": string | null,"id": string,"is_active": boolean,"product_id": string | null,"rate_percent": number,"role_id": string | null,"updated_at": string,"user_id": string | null
                  }
                  Insert: {
                    "created_at"?: string,"effective_from": string,"effective_to"?: string | null,"id"?: string,"is_active"?: boolean,"product_id"?: string | null,"rate_percent": number,"role_id"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"effective_from"?: string,"effective_to"?: string | null,"id"?: string,"is_active"?: boolean,"product_id"?: string | null,"rate_percent"?: number,"role_id"?: string | null,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "commission_rules_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commission_rules_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "commission_rules_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"customers": {
                  Row: {
                    "address": string | null,"company_address": string | null,"company_name": string | null,"contact_name": string | null,"contact_title": string | null,"created_at": string,"created_by": string,"customer_type": string,"email": string | null,"id": string,"is_archived": boolean,"name": string | null,"phone": string | null,"phone_normalized": string | null,"tax_code": string | null,"updated_at": string
                  }
                  Insert: {
                    "address"?: string | null,"company_address"?: string | null,"company_name"?: string | null,"contact_name"?: string | null,"contact_title"?: string | null,"created_at"?: string,"created_by": string,"customer_type": string,"email"?: string | null,"id"?: string,"is_archived"?: boolean,"name"?: string | null,"phone"?: string | null,"phone_normalized"?: never,"tax_code"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "address"?: string | null,"company_address"?: string | null,"company_name"?: string | null,"contact_name"?: string | null,"contact_title"?: string | null,"created_at"?: string,"created_by"?: string,"customer_type"?: string,"email"?: string | null,"id"?: string,"is_archived"?: boolean,"name"?: string | null,"phone"?: string | null,"phone_normalized"?: never,"tax_code"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"lead_sources": {
                  Row: {
                    "code": string,"id": string,"is_active": boolean,"name": string,"sort_order": number
                  }
                  Insert: {
                    "code": string,"id"?: string,"is_active"?: boolean,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "code"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"locations": {
                  Row: {
                    "address": string | null,"code": string,"created_at": string,"id": string,"is_active": boolean,"location_type": string,"name": string,"phone": string | null,"region": string | null
                  }
                  Insert: {
                    "address"?: string | null,"code": string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"location_type": string,"name": string,"phone"?: string | null,"region"?: string | null
                  }
                  Update: {
                    "address"?: string | null,"code"?: string,"created_at"?: string,"id"?: string,"is_active"?: boolean,"location_type"?: string,"name"?: string,"phone"?: string | null,"region"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"order_items": {
                  Row: {
                    "allocated_quantity": number,"created_at": string,"delivered_quantity": number,"gross_line_amount": number,"id": string,"list_price": number,"order_id": string,"product_id": string,"quantity": number,"returned_quantity": number
                  }
                  Insert: {
                    "allocated_quantity"?: number,"created_at"?: string,"delivered_quantity"?: number,"gross_line_amount": number,"id"?: string,"list_price": number,"order_id": string,"product_id": string,"quantity": number,"returned_quantity"?: number
                  }
                  Update: {
                    "allocated_quantity"?: number,"created_at"?: string,"delivered_quantity"?: number,"gross_line_amount"?: number,"id"?: string,"list_price"?: number,"order_id"?: string,"product_id"?: string,"quantity"?: number,"returned_quantity"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"order_status_history": {
                  Row: {
                    "actor_user_id": string | null,"created_at": string,"from_status": string | null,"id": string,"order_id": string,"reason": string | null,"to_status": string
                  }
                  Insert: {
                    "actor_user_id"?: string | null,"created_at"?: string,"from_status"?: string | null,"id"?: string,"order_id": string,"reason"?: string | null,"to_status": string
                  }
                  Update: {
                    "actor_user_id"?: string | null,"created_at"?: string,"from_status"?: string | null,"id"?: string,"order_id"?: string,"reason"?: string | null,"to_status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_status_history_actor_user_id_fkey"
      columns: ["actor_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_status_history_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "cancel_reason": string | null,"cancelled_at": string | null,"completed_at": string | null,"confirmed_at": string | null,"created_at": string,"created_by": string,"creation_location_id": string,"customer_id": string,"deposit_required": number,"discount_amount": number,"gross_amount": number,"id": string,"lead_source_id": string,"net_amount": number,"notes": string | null,"order_code": string,"owner_user_id": string,"paid_amount": number,"remaining_amount": number | null,"requires_invoice": boolean,"reservation_expires_at": string | null,"sales_channel_id": string,"status": string,"updated_at": string,"void_reason": string | null,"voided_at": string | null
                  }
                  Insert: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"completed_at"?: string | null,"confirmed_at"?: string | null,"created_at"?: string,"created_by": string,"creation_location_id": string,"customer_id": string,"deposit_required"?: number,"discount_amount"?: number,"gross_amount"?: number,"id"?: string,"lead_source_id": string,"net_amount"?: number,"notes"?: string | null,"order_code": string,"owner_user_id": string,"paid_amount"?: number,"remaining_amount"?: never,"requires_invoice"?: boolean,"reservation_expires_at"?: string | null,"sales_channel_id": string,"status"?: string,"updated_at"?: string,"void_reason"?: string | null,"voided_at"?: string | null
                  }
                  Update: {
                    "cancel_reason"?: string | null,"cancelled_at"?: string | null,"completed_at"?: string | null,"confirmed_at"?: string | null,"created_at"?: string,"created_by"?: string,"creation_location_id"?: string,"customer_id"?: string,"deposit_required"?: number,"discount_amount"?: number,"gross_amount"?: number,"id"?: string,"lead_source_id"?: string,"net_amount"?: number,"notes"?: string | null,"order_code"?: string,"owner_user_id"?: string,"paid_amount"?: number,"remaining_amount"?: never,"requires_invoice"?: boolean,"reservation_expires_at"?: string | null,"sales_channel_id"?: string,"status"?: string,"updated_at"?: string,"void_reason"?: string | null,"voided_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_creation_location_id_fkey"
      columns: ["creation_location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_lead_source_id_fkey"
      columns: ["lead_source_id"]
isOneToOne: false
      referencedRelation: "lead_sources"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_owner_user_id_fkey"
      columns: ["owner_user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_sales_channel_id_fkey"
      columns: ["sales_channel_id"]
isOneToOne: false
      referencedRelation: "sales_channels"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "category": string | null,"created_at": string,"default_commission_rate": number,"id": string,"is_active": boolean,"list_price": number,"name": string,"sku": string,"updated_at": string,"weight_gram": number | null
                  }
                  Insert: {
                    "category"?: string | null,"created_at"?: string,"default_commission_rate"?: number,"id"?: string,"is_active"?: boolean,"list_price": number,"name": string,"sku": string,"updated_at"?: string,"weight_gram"?: number | null
                  }
                  Update: {
                    "category"?: string | null,"created_at"?: string,"default_commission_rate"?: number,"id"?: string,"is_active"?: boolean,"list_price"?: number,"name"?: string,"sku"?: string,"updated_at"?: string,"weight_gram"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"default_lead_source_id": string | null,"default_location_id": string | null,"default_sales_channel_id": string | null,"full_name": string,"id": string,"is_active": boolean,"phone": string | null,"role_id": string,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"default_lead_source_id"?: string | null,"default_location_id"?: string | null,"default_sales_channel_id"?: string | null,"full_name": string,"id": string,"is_active"?: boolean,"phone"?: string | null,"role_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"default_lead_source_id"?: string | null,"default_location_id"?: string | null,"default_sales_channel_id"?: string | null,"full_name"?: string,"id"?: string,"is_active"?: boolean,"phone"?: string | null,"role_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_default_lead_source_id_fkey"
      columns: ["default_lead_source_id"]
isOneToOne: false
      referencedRelation: "lead_sources"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profiles_default_location_id_fkey"
      columns: ["default_location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profiles_default_sales_channel_id_fkey"
      columns: ["default_sales_channel_id"]
isOneToOne: false
      referencedRelation: "sales_channels"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profiles_role_id_fkey"
      columns: ["role_id"]
isOneToOne: false
      referencedRelation: "roles"
      referencedColumns: ["id"]
    }
                  ]
                },"roles": {
                  Row: {
                    "code": string,"created_at": string,"description": string | null,"id": string,"name": string,"permissions": NonNullable<Json>
                  }
                  Insert: {
                    "code": string,"created_at"?: string,"description"?: string | null,"id"?: string,"name": string,"permissions"?: NonNullable<Json>
                  }
                  Update: {
                    "code"?: string,"created_at"?: string,"description"?: string | null,"id"?: string,"name"?: string,"permissions"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"safety_stock_rules": {
                  Row: {
                    "id": string,"location_id": string,"minimum_qty": number,"product_id": string,"updated_at": string,"updated_by": string | null
                  }
                  Insert: {
                    "id"?: string,"location_id": string,"minimum_qty": number,"product_id": string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Update: {
                    "id"?: string,"location_id"?: string,"minimum_qty"?: number,"product_id"?: string,"updated_at"?: string,"updated_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "safety_stock_rules_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "safety_stock_rules_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "safety_stock_rules_updated_by_fkey"
      columns: ["updated_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"sales_channels": {
                  Row: {
                    "code": string,"id": string,"is_active": boolean,"name": string,"sort_order": number
                  }
                  Insert: {
                    "code": string,"id"?: string,"is_active"?: boolean,"name": string,"sort_order"?: number
                  }
                  Update: {
                    "code"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "customer_order_summary":
{ Args: { "p_customer_ids": (string)[] }; Returns: {
              "customer_id": string,"last_order_at": string,"order_count": number,"total_gross": number
            }[]
                           },
"find_similar_customers":
{ Args: { "p_exclude_id"?: string,"p_phone"?: string,"p_tax_code"?: string }; Returns: {
              "address": string | null,
"company_address": string | null,
"company_name": string | null,
"contact_name": string | null,
"contact_title": string | null,
"created_at": string,
"created_by": string,
"customer_type": string,
"email": string | null,
"id": string,
"is_archived": boolean,
"name": string | null,
"phone": string | null,
"phone_normalized": string | null,
"tax_code": string | null,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "customers"
        isOneToOne: false
        isSetofReturn: true
      } },
"normalize_phone":
{ Args: { "p_phone": string }; Returns: string
                           },
"quote_order":
{ Args: { "p_items"?: Json,"p_owner_user_id"?: string }; Returns: Json
                           },
"save_draft_order":
{ Args: { "p_creation_location_id"?: string,"p_customer_id": string,"p_discount_amount"?: number,"p_items": Json,"p_lead_source_id"?: string,"p_notes"?: string,"p_order_id": string,"p_owner_user_id"?: string,"p_requires_invoice"?: boolean,"p_sales_channel_id"?: string }; Returns: {
              "cancel_reason": string | null,
"cancelled_at": string | null,
"completed_at": string | null,
"confirmed_at": string | null,
"created_at": string,
"created_by": string,
"creation_location_id": string,
"customer_id": string,
"deposit_required": number,
"discount_amount": number,
"gross_amount": number,
"id": string,
"lead_source_id": string,
"net_amount": number,
"notes": string | null,
"order_code": string,
"owner_user_id": string,
"paid_amount": number,
"remaining_amount": number | null,
"requires_invoice": boolean,
"reservation_expires_at": string | null,
"sales_channel_id": string,
"status": string,
"updated_at": string,
"void_reason": string | null,
"voided_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "orders"
        isOneToOne: true
        isSetofReturn: false
      } },
"search_customers":
{ Args: { "p_customer_type"?: string,"p_include_archived"?: boolean,"p_limit"?: number,"p_offset"?: number,"p_query"?: string }; Returns: {
              "address": string | null,
"company_address": string | null,
"company_name": string | null,
"contact_name": string | null,
"contact_title": string | null,
"created_at": string,
"created_by": string,
"customer_type": string,
"email": string | null,
"id": string,
"is_archived": boolean,
"name": string | null,
"phone": string | null,
"phone_normalized": string | null,
"tax_code": string | null,
"updated_at": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "customers"
        isOneToOne: false
        isSetofReturn: true
      } },
"transition_order":
{ Args: { "p_action": string,"p_order_id": string,"p_reason"?: string }; Returns: {
              "cancel_reason": string | null,
"cancelled_at": string | null,
"completed_at": string | null,
"confirmed_at": string | null,
"created_at": string,
"created_by": string,
"creation_location_id": string,
"customer_id": string,
"deposit_required": number,
"discount_amount": number,
"gross_amount": number,
"id": string,
"lead_source_id": string,
"net_amount": number,
"notes": string | null,
"order_code": string,
"owner_user_id": string,
"paid_amount": number,
"remaining_amount": number | null,
"requires_invoice": boolean,
"reservation_expires_at": string | null,
"sales_channel_id": string,
"status": string,
"updated_at": string,
"void_reason": string | null,
"voided_at": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "orders"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
