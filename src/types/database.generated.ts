
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
                },"deliveries": {
                  Row: {
                    "cancelled_reason": string | null,"created_at": string,"created_by": string | null,"delivered_at": string | null,"delivery_address": string | null,"delivery_code": string,"delivery_method": string,"failed_reason": string | null,"id": string,"notes": string | null,"order_id": string,"recipient_name": string,"recipient_phone": string,"scheduled_date": string,"scheduled_time": string | null,"shipping_fee": number,"shipping_fee_payer": string,"source_location_id": string,"status": string,"updated_at": string
                  }
                  Insert: {
                    "cancelled_reason"?: string | null,"created_at"?: string,"created_by"?: string | null,"delivered_at"?: string | null,"delivery_address"?: string | null,"delivery_code": string,"delivery_method"?: string,"failed_reason"?: string | null,"id"?: string,"notes"?: string | null,"order_id": string,"recipient_name": string,"recipient_phone": string,"scheduled_date": string,"scheduled_time"?: string | null,"shipping_fee"?: number,"shipping_fee_payer"?: string,"source_location_id": string,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "cancelled_reason"?: string | null,"created_at"?: string,"created_by"?: string | null,"delivered_at"?: string | null,"delivery_address"?: string | null,"delivery_code"?: string,"delivery_method"?: string,"failed_reason"?: string | null,"id"?: string,"notes"?: string | null,"order_id"?: string,"recipient_name"?: string,"recipient_phone"?: string,"scheduled_date"?: string,"scheduled_time"?: string | null,"shipping_fee"?: number,"shipping_fee_payer"?: string,"source_location_id"?: string,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "deliveries_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "deliveries_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "deliveries_source_location_id_fkey"
      columns: ["source_location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    }
                  ]
                },"delivery_items": {
                  Row: {
                    "batch_id": string | null,"created_at": string,"delivery_id": string,"id": string,"order_item_id": string,"product_id": string,"quantity": number
                  }
                  Insert: {
                    "batch_id"?: string | null,"created_at"?: string,"delivery_id": string,"id"?: string,"order_item_id": string,"product_id": string,"quantity": number
                  }
                  Update: {
                    "batch_id"?: string | null,"created_at"?: string,"delivery_id"?: string,"id"?: string,"order_item_id"?: string,"product_id"?: string,"quantity"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "delivery_items_batch_id_fkey"
      columns: ["batch_id"]
isOneToOne: false
      referencedRelation: "product_batches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "delivery_items_delivery_id_fkey"
      columns: ["delivery_id"]
isOneToOne: false
      referencedRelation: "deliveries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "delivery_items_order_item_id_fkey"
      columns: ["order_item_id"]
isOneToOne: false
      referencedRelation: "order_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "delivery_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"inventory_balances": {
                  Row: {
                    "available_qty": number,"batch_id": string,"damaged_qty": number,"gift_qty": number,"id": string,"in_transfer_qty": number,"location_id": string,"pending_inspection_qty": number,"product_id": string,"reserved_qty": number,"sample_qty": number,"updated_at": string
                  }
                  Insert: {
                    "available_qty"?: number,"batch_id": string,"damaged_qty"?: number,"gift_qty"?: number,"id"?: string,"in_transfer_qty"?: number,"location_id": string,"pending_inspection_qty"?: number,"product_id": string,"reserved_qty"?: number,"sample_qty"?: number,"updated_at"?: string
                  }
                  Update: {
                    "available_qty"?: number,"batch_id"?: string,"damaged_qty"?: number,"gift_qty"?: number,"id"?: string,"in_transfer_qty"?: number,"location_id"?: string,"pending_inspection_qty"?: number,"product_id"?: string,"reserved_qty"?: number,"sample_qty"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_balances_batch_id_fkey"
      columns: ["batch_id"]
isOneToOne: false
      referencedRelation: "product_batches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_balances_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_balances_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"inventory_movements": {
                  Row: {
                    "batch_id": string,"created_at": string,"created_by": string | null,"delivery_id": string | null,"from_location_id": string | null,"id": string,"movement_type": string,"order_id": string | null,"product_id": string,"production_run_id": string | null,"quantity": number,"reason": string | null,"return_id": string | null,"to_location_id": string | null,"transfer_id": string | null
                  }
                  Insert: {
                    "batch_id": string,"created_at"?: string,"created_by"?: string | null,"delivery_id"?: string | null,"from_location_id"?: string | null,"id"?: string,"movement_type": string,"order_id"?: string | null,"product_id": string,"production_run_id"?: string | null,"quantity": number,"reason"?: string | null,"return_id"?: string | null,"to_location_id"?: string | null,"transfer_id"?: string | null
                  }
                  Update: {
                    "batch_id"?: string,"created_at"?: string,"created_by"?: string | null,"delivery_id"?: string | null,"from_location_id"?: string | null,"id"?: string,"movement_type"?: string,"order_id"?: string | null,"product_id"?: string,"production_run_id"?: string | null,"quantity"?: number,"reason"?: string | null,"return_id"?: string | null,"to_location_id"?: string | null,"transfer_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_movements_batch_id_fkey"
      columns: ["batch_id"]
isOneToOne: false
      referencedRelation: "product_batches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_delivery_id_fkey"
      columns: ["delivery_id"]
isOneToOne: false
      referencedRelation: "deliveries"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_from_location_id_fkey"
      columns: ["from_location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_to_location_id_fkey"
      columns: ["to_location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    }
                  ]
                },"inventory_reservations": {
                  Row: {
                    "batch_id": string,"expires_at": string | null,"id": string,"location_id": string,"order_id": string,"order_item_id": string,"product_id": string,"quantity": number,"release_reason": string | null,"released_at": string | null,"reservation_type": string,"reserved_at": string,"status": string
                  }
                  Insert: {
                    "batch_id": string,"expires_at"?: string | null,"id"?: string,"location_id": string,"order_id": string,"order_item_id": string,"product_id": string,"quantity": number,"release_reason"?: string | null,"released_at"?: string | null,"reservation_type": string,"reserved_at"?: string,"status"?: string
                  }
                  Update: {
                    "batch_id"?: string,"expires_at"?: string | null,"id"?: string,"location_id"?: string,"order_id"?: string,"order_item_id"?: string,"product_id"?: string,"quantity"?: number,"release_reason"?: string | null,"released_at"?: string | null,"reservation_type"?: string,"reserved_at"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_reservations_batch_id_fkey"
      columns: ["batch_id"]
isOneToOne: false
      referencedRelation: "product_batches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_reservations_location_id_fkey"
      columns: ["location_id"]
isOneToOne: false
      referencedRelation: "locations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_reservations_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_reservations_order_item_id_fkey"
      columns: ["order_item_id"]
isOneToOne: false
      referencedRelation: "order_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_reservations_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
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
                },"payment_events": {
                  Row: {
                    "id": string,"note": string | null,"order_id": string | null,"outcome": string,"payload": NonNullable<Json>,"payment_id": string | null,"provider": string,"provider_event_id": string,"received_at": string,"resolved_at": string | null,"resolved_by": string | null
                  }
                  Insert: {
                    "id"?: string,"note"?: string | null,"order_id"?: string | null,"outcome"?: string,"payload": NonNullable<Json>,"payment_id"?: string | null,"provider": string,"provider_event_id": string,"received_at"?: string,"resolved_at"?: string | null,"resolved_by"?: string | null
                  }
                  Update: {
                    "id"?: string,"note"?: string | null,"order_id"?: string | null,"outcome"?: string,"payload"?: NonNullable<Json>,"payment_id"?: string | null,"provider"?: string,"provider_event_id"?: string,"received_at"?: string,"resolved_at"?: string | null,"resolved_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_events_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_events_payment_id_fkey"
      columns: ["payment_id"]
isOneToOne: false
      referencedRelation: "payments"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payment_events_resolved_by_fkey"
      columns: ["resolved_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"payments": {
                  Row: {
                    "amount": number,"confirmed_by": string | null,"created_at": string,"created_by": string | null,"id": string,"method": string,"note": string | null,"order_id": string,"paid_at": string | null,"payment_code": string,"provider": string | null,"provider_reference": string | null,"status": string,"status_reason": string | null,"transfer_content": string | null,"updated_at": string
                  }
                  Insert: {
                    "amount": number,"confirmed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"method": string,"note"?: string | null,"order_id": string,"paid_at"?: string | null,"payment_code": string,"provider"?: string | null,"provider_reference"?: string | null,"status"?: string,"status_reason"?: string | null,"transfer_content"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "amount"?: number,"confirmed_by"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"method"?: string,"note"?: string | null,"order_id"?: string,"paid_at"?: string | null,"payment_code"?: string,"provider"?: string | null,"provider_reference"?: string | null,"status"?: string,"status_reason"?: string | null,"transfer_content"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "payments_confirmed_by_fkey"
      columns: ["confirmed_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_created_by_fkey"
      columns: ["created_by"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "payments_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"product_batches": {
                  Row: {
                    "batch_code": string,"created_at": string,"expiry_date": string,"id": string,"manufactured_date": string,"product_id": string,"production_run_id": string | null,"status": string
                  }
                  Insert: {
                    "batch_code": string,"created_at"?: string,"expiry_date": string,"id"?: string,"manufactured_date": string,"product_id": string,"production_run_id"?: string | null,"status"?: string
                  }
                  Update: {
                    "batch_code"?: string,"created_at"?: string,"expiry_date"?: string,"id"?: string,"manufactured_date"?: string,"product_id"?: string,"production_run_id"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_batches_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
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
            "adjust_inventory":
{ Args: { "p_batch_id": string,"p_direction": string,"p_location_id": string,"p_product_id": string,"p_quantity": number,"p_reason": string }; Returns: {
              "batch_id": string,
"created_at": string,
"created_by": string | null,
"delivery_id": string | null,
"from_location_id": string | null,
"id": string,
"movement_type": string,
"order_id": string | null,
"product_id": string,
"production_run_id": string | null,
"quantity": number,
"reason": string | null,
"return_id": string | null,
"to_location_id": string | null,
"transfer_id": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "inventory_movements"
        isOneToOne: true
        isSetofReturn: false
      } },
"allocate_order":
{ Args: { "p_allow_below_safety"?: boolean,"p_location_id"?: string,"p_order_id": string }; Returns: Json
                           },
"assign_payment_event":
{ Args: { "p_event_id": string,"p_order_id": string }; Returns: {
              "amount": number,
"confirmed_by": string | null,
"created_at": string,
"created_by": string | null,
"id": string,
"method": string,
"note": string | null,
"order_id": string,
"paid_at": string | null,
"payment_code": string,
"provider": string | null,
"provider_reference": string | null,
"status": string,
"status_reason": string | null,
"transfer_content": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "payments"
        isOneToOne: true
        isSetofReturn: false
      } },
"check_stock":
{ Args: { "p_items": Json,"p_location_id": string }; Returns: Json
                           },
"committed_demand":
{ Args: Record<PropertyKey, never>; Returns: {
              "committed_qty": number,"order_count": number,"product_id": string
            }[]
                           },
"confirm_payment":
{ Args: { "p_payment_id": string }; Returns: {
              "amount": number,
"confirmed_by": string | null,
"created_at": string,
"created_by": string | null,
"id": string,
"method": string,
"note": string | null,
"order_id": string,
"paid_at": string | null,
"payment_code": string,
"provider": string | null,
"provider_reference": string | null,
"status": string,
"status_reason": string | null,
"transfer_content": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "payments"
        isOneToOne: true
        isSetofReturn: false
      } },
"customer_order_summary":
{ Args: { "p_customer_ids": (string)[] }; Returns: {
              "customer_id": string,"last_order_at": string,"order_count": number,"total_gross": number
            }[]
                           },
"delivery_detail":
{ Args: { "p_delivery_id": string }; Returns: Json
                           },
"delivery_schedule":
{ Args: { "p_from": string,"p_statuses"?: (string)[],"p_to": string }; Returns: {
              "customer_name": string,"delivery_address": string,"delivery_code": string,"delivery_id": string,"delivery_method": string,"lines": Json,"order_code": string,"order_id": string,"order_status": string,"owner_name": string,"recipient_name": string,"recipient_phone": string,"remaining_amount": number,"scheduled_date": string,"scheduled_time": string,"shipping_fee": number,"shipping_fee_payer": string,"source_location_code": string,"source_location_id": string,"status": string,"stock_risk": boolean,"total_quantity": number
            }[]
                           },
"dismiss_payment_event":
{ Args: { "p_event_id": string,"p_note": string }; Returns: undefined
                           },
"fail_payment":
{ Args: { "p_payment_id": string,"p_reason": string }; Returns: {
              "amount": number,
"confirmed_by": string | null,
"created_at": string,
"created_by": string | null,
"id": string,
"method": string,
"note": string | null,
"order_id": string,
"paid_at": string | null,
"payment_code": string,
"provider": string | null,
"provider_reference": string | null,
"status": string,
"status_reason": string | null,
"transfer_content": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "payments"
        isOneToOne: true
        isSetofReturn: false
      } },
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
"import_opening_stock":
{ Args: { "p_dry_run"?: boolean,"p_rows": Json }; Returns: Json
                           },
"inventory_summary":
{ Args: { "p_location_id"?: string }; Returns: {
              "available_qty": number,"damaged_qty": number,"expired_qty": number,"gift_qty": number,"in_transfer_qty": number,"location_id": string,"pending_inspection_qty": number,"product_id": string,"reserved_qty": number,"safety_stock_qty": number,"sample_qty": number,"sellable_qty": number
            }[]
                           },
"normalize_phone":
{ Args: { "p_phone": string }; Returns: string
                           },
"order_stock_status":
{ Args: { "p_order_id": string }; Returns: Json
                           },
"payment_instructions":
{ Args: { "p_order_id": string }; Returns: Json
                           },
"process_sepay_webhook":
{ Args: { "p_payload": Json }; Returns: Json
                           },
"quote_order":
{ Args: { "p_items"?: Json,"p_owner_user_id"?: string }; Returns: Json
                           },
"record_opening_stock":
{ Args: { "p_batch_id": string,"p_location_id": string,"p_note"?: string,"p_product_id": string,"p_quantity": number }; Returns: {
              "batch_id": string,
"created_at": string,
"created_by": string | null,
"delivery_id": string | null,
"from_location_id": string | null,
"id": string,
"movement_type": string,
"order_id": string | null,
"product_id": string,
"production_run_id": string | null,
"quantity": number,
"reason": string | null,
"return_id": string | null,
"to_location_id": string | null,
"transfer_id": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "inventory_movements"
        isOneToOne: true
        isSetofReturn: false
      } },
"record_payment":
{ Args: { "p_amount": number,"p_confirm"?: boolean,"p_method": string,"p_note"?: string,"p_order_id": string,"p_transfer_content"?: string }; Returns: {
              "amount": number,
"confirmed_by": string | null,
"created_at": string,
"created_by": string | null,
"id": string,
"method": string,
"note": string | null,
"order_id": string,
"paid_at": string | null,
"payment_code": string,
"provider": string | null,
"provider_reference": string | null,
"status": string,
"status_reason": string | null,
"transfer_content": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "payments"
        isOneToOne: true
        isSetofReturn: false
      } },
"record_stock_exit":
{ Args: { "p_batch_id": string,"p_location_id": string,"p_product_id": string,"p_quantity": number,"p_reason": string,"p_type": string }; Returns: {
              "batch_id": string,
"created_at": string,
"created_by": string | null,
"delivery_id": string | null,
"from_location_id": string | null,
"id": string,
"movement_type": string,
"order_id": string | null,
"product_id": string,
"production_run_id": string | null,
"quantity": number,
"reason": string | null,
"return_id": string | null,
"to_location_id": string | null,
"transfer_id": string | null
            }
                          SetofOptions: {
        from: "*"
        to: "inventory_movements"
        isOneToOne: true
        isSetofReturn: false
      } },
"refund_payment":
{ Args: { "p_payment_id": string,"p_reason": string }; Returns: {
              "amount": number,
"confirmed_by": string | null,
"created_at": string,
"created_by": string | null,
"id": string,
"method": string,
"note": string | null,
"order_id": string,
"paid_at": string | null,
"payment_code": string,
"provider": string | null,
"provider_reference": string | null,
"status": string,
"status_reason": string | null,
"transfer_content": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "payments"
        isOneToOne: true
        isSetofReturn: false
      } },
"release_expired_reservations":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"reschedule_delivery":
{ Args: { "p_delivery_id": string,"p_reason"?: string,"p_scheduled_date": string,"p_scheduled_time"?: string }; Returns: {
              "cancelled_reason": string | null,
"created_at": string,
"created_by": string | null,
"delivered_at": string | null,
"delivery_address": string | null,
"delivery_code": string,
"delivery_method": string,
"failed_reason": string | null,
"id": string,
"notes": string | null,
"order_id": string,
"recipient_name": string,
"recipient_phone": string,
"scheduled_date": string,
"scheduled_time": string | null,
"shipping_fee": number,
"shipping_fee_payer": string,
"source_location_id": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "deliveries"
        isOneToOne: true
        isSetofReturn: false
      } },
"save_delivery":
{ Args: { "p_delivery_address"?: string,"p_delivery_id": string,"p_delivery_method"?: string,"p_items": Json,"p_notes"?: string,"p_order_id": string,"p_recipient_name"?: string,"p_recipient_phone"?: string,"p_scheduled_date": string,"p_scheduled_time"?: string,"p_shipping_fee"?: number,"p_shipping_fee_payer"?: string,"p_source_location_id"?: string }; Returns: {
              "cancelled_reason": string | null,
"created_at": string,
"created_by": string | null,
"delivered_at": string | null,
"delivery_address": string | null,
"delivery_code": string,
"delivery_method": string,
"failed_reason": string | null,
"id": string,
"notes": string | null,
"order_id": string,
"recipient_name": string,
"recipient_phone": string,
"scheduled_date": string,
"scheduled_time": string | null,
"shipping_fee": number,
"shipping_fee_payer": string,
"source_location_id": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "deliveries"
        isOneToOne: true
        isSetofReturn: false
      } },
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
"suggest_transfer_sources":
{ Args: { "p_destination_location_id": string,"p_product_id": string,"p_quantity": number }; Returns: {
              "covers_all": boolean,"earliest_expiry": string,"location_code": string,"location_id": string,"location_name": string,"region": string,"same_region": boolean,"sellable_qty": number
            }[]
                           },
"transition_delivery":
{ Args: { "p_action": string,"p_delivery_id": string,"p_reason"?: string }; Returns: {
              "cancelled_reason": string | null,
"created_at": string,
"created_by": string | null,
"delivered_at": string | null,
"delivery_address": string | null,
"delivery_code": string,
"delivery_method": string,
"failed_reason": string | null,
"id": string,
"notes": string | null,
"order_id": string,
"recipient_name": string,
"recipient_phone": string,
"scheduled_date": string,
"scheduled_time": string | null,
"shipping_fee": number,
"shipping_fee_payer": string,
"source_location_id": string,
"status": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "deliveries"
        isOneToOne: true
        isSetofReturn: false
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
      } },
"verify_inventory_balances":
{ Args: Record<PropertyKey, never>; Returns: {
              "batch_id": string,"cached_qty": number,"column_name": string,"ledger_qty": number,"location_id": string,"product_id": string
            }[]
                           },
"void_payment":
{ Args: { "p_payment_id": string,"p_reason": string }; Returns: {
              "amount": number,
"confirmed_by": string | null,
"created_at": string,
"created_by": string | null,
"id": string,
"method": string,
"note": string | null,
"order_id": string,
"paid_at": string | null,
"payment_code": string,
"provider": string | null,
"provider_reference": string | null,
"status": string,
"status_reason": string | null,
"transfer_content": string | null,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "payments"
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
