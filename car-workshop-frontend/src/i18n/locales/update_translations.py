import json

with open('en.json', 'r') as f:
    data = json.load(f)

# ── common additions ─────────────────────────────────────────────────────────
data['common'].update({
    "saving": "Saving\u2026",
    "save_changes": "Save Changes",
    "creating": "Creating\u2026",
    "submitting": "Submitting\u2026",
    "sending": "Sending\u2026",
    "exporting": "Exporting\u2026",
    "track": "Track",
    "vehicle": "Vehicle",
    "plate": "Plate",
    "recipient": "Recipient",
    "unassigned": "Unassigned",
    "area": "Area",
    "emirate": "Emirate",
    "city": "City",
    "item": "Item",
    "orders": "Orders",
    "company": "Company",
    "payment_method": "Payment",
    "no_results_hint": "Try adjusting your search or filters",
    "load_error": "Unable to load details",
    "try_again": "Please try again",
    "export_csv": "Export CSV",
    "order_num": "Order #"
})

# ── settings – full replacement ──────────────────────────────────────────────
data['settings'] = {
    "title": "Settings",
    "page_title": "Settings",
    "page_sub": "Configure your delivery platform",
    "loading": "Loading settings\u2026",
    "tabs": {
        "general": "General",
        "delivery": "Delivery",
        "notifications": "Notifications",
        "categories": "Categories",
        "users": "Users"
    },
    "tab_sub": {
        "general": "Company info, branding and regional preferences",
        "delivery": "Delivery defaults, COD rules and feature toggles",
        "notifications": "Email SMTP and SMS gateway configuration",
        "categories": "Manage order categories and shipment types",
        "users": "Manage team members and their roles"
    },
    "general": {
        "company_info_title": "Company Information",
        "company_info_sub": "Your business identity and contact details",
        "company_name": "Company Name",
        "company_phone": "Company Phone",
        "company_email": "Company Email",
        "website": "Website",
        "company_address": "Company Address",
        "city": "City",
        "vat_number": "VAT Number",
        "logo_url": "Logo URL",
        "regional_title": "Regional Settings",
        "regional_sub": "Timezone, currency and locale",
        "timezone": "Timezone",
        "currency": "Currency",
        "country": "Country",
        "default_language": "Default Language"
    },
    "delivery": {
        "defaults_title": "Delivery Defaults",
        "defaults_sub": "Default values applied to new orders",
        "default_emirate": "Default Emirate",
        "default_fee": "Default Delivery Fee (AED)",
        "max_cod": "Max COD Amount (AED)",
        "driver_commission": "Driver Commission (%)",
        "expected_days": "Expected Delivery Days",
        "max_weight": "Max Weight (kg)",
        "feature_toggles_title": "Feature Toggles",
        "feature_toggles_sub": "Enable or disable platform features",
        "toggle_cod": "Cash on Delivery (COD)",
        "toggle_cod_desc": "Allow orders to be paid on delivery",
        "toggle_returns": "Return Orders",
        "toggle_returns_desc": "Enable return/reverse logistics",
        "toggle_express": "Express Delivery",
        "toggle_express_desc": "Allow same-day / express order types",
        "toggle_sms": "SMS Tracking Notifications",
        "toggle_sms_desc": "Send automated SMS when status changes",
        "toggle_email": "Email Tracking Notifications",
        "toggle_email_desc": "Send automated emails when status changes",
        "toggle_tips": "Driver Tips",
        "toggle_tips_desc": "Allow recipients to tip the driver"
    },
    "notifications": {
        "smtp_title": "Email / SMTP",
        "smtp_sub": "Configure outbound email delivery",
        "smtp_host": "SMTP Host",
        "smtp_port": "SMTP Port",
        "smtp_user": "SMTP Username",
        "smtp_pass": "SMTP Password",
        "from_name": "From Name",
        "reply_to": "Reply-To Email",
        "sms_title": "SMS Settings",
        "sms_sub": "Configure SMS gateway for notifications",
        "sms_sender_id": "SMS Sender ID",
        "twilio_sid": "Twilio Account SID",
        "twilio_token": "Twilio Auth Token",
        "twilio_phone": "Twilio Phone Number",
        "sms_info": "SMS notifications are sent automatically when an order status changes if SMS Tracking is enabled in Delivery settings."
    },
    "categories": {
        "add": "Add Category",
        "edit": "Edit Category",
        "new": "New Category",
        "name_en": "Name (English) *",
        "name_ar": "Name (Arabic)",
        "color": "Color"
    },
    "users": {
        "team_members": "Team Members",
        "add_user": "Add User",
        "modal_title": "Add Team Member",
        "full_name": "Full Name *",
        "username": "Username *",
        "email": "Email *",
        "password": "Password *",
        "password_placeholder": "Min. 6 characters",
        "role": "Role",
        "create_user": "Create User"
    }
}

# ── reports additions ────────────────────────────────────────────────────────
data['reports'].update({
    "last_year": "Last year",
    "pdf_report": "PDF Report",
    "no_data": "No data available",
    "no_orders_period": "No orders found for the selected period",
    "no_zone_data": "No zone data yet.",
    "no_driver_data_text": "No driver data yet",
    "no_payment_data": "No payment data",
    "no_client_data": "No client data",
    "no_client_orders": "No client-linked orders found for the selected period",
    "no_order_type_data": "No order type data",
    "no_order_type_sub": "Order types not recorded for this period",
    "no_delivery_time": "No delivery time data",
    "no_delivery_time_sub": "No delivered orders with timing data for this period",
    "tabs": {
        "overview": "Overview",
        "daily_volume": "Daily Volume",
        "by_zone": "By Zone",
        "driver_performance": "Driver Performance",
        "clients": "Clients",
        "order_types": "Order Types",
        "delivery_time": "Delivery Time",
        "payments": "Payments",
        "financial": "Financial",
        "schedules": "Email Schedules"
    },
    "kpi": {
        "total_orders": "Total Orders",
        "delivered": "Delivered",
        "failed": "Failed",
        "revenue": "Revenue",
        "cod_collected": "COD Collected",
        "success_rate": "Success Rate"
    },
    "col": {
        "reason": "Reason",
        "count": "Count",
        "pct_failed": "% of Failed",
        "success_rate": "Success Rate",
        "revenue": "Revenue",
        "rating": "Rating",
        "method": "Method",
        "avg_time": "Avg Time",
        "slowest": "Slowest",
        "success_pct": "Success %",
        "avg_value": "Avg Value",
        "pct_total": "% of Total",
        "cod": "COD",
        "revenue_generated": "Revenue Generated"
    },
    "chart": {
        "status_breakdown": "Order Status Breakdown",
        "by_emirate": "Orders by Emirate",
        "zone_density": "Zone Order Density",
        "orders_label": "orders",
        "success_label": "success",
        "orders_by_zone": "Orders by Zone",
        "top_drivers": "Top Drivers by Deliveries",
        "payment_distribution": "Payment Method Distribution",
        "payment_breakdown": "Payment Breakdown",
        "top_clients": "Top Clients by Orders",
        "revenue_by_client": "Revenue by Client",
        "order_types_dist": "Order Types Distribution",
        "order_type_breakdown": "Order Type Breakdown",
        "revenue_trend": "Revenue Trend",
        "revenue_by_payment": "Revenue by Payment Method",
        "revenue_by_zone": "Revenue by Zone",
        "top_clients_revenue": "Top Clients by Revenue",
        "driver_settlements": "Driver Settlements"
    },
    "financial": {
        "gross_fees": "Gross Fees",
        "discounts": "Discounts",
        "net_revenue": "Net Revenue",
        "cod_collected": "COD Collected",
        "cod_settled": "COD Settled",
        "cod_pending": "COD Pending"
    },
    "schedules": {
        "title": "Scheduled Email Reports",
        "new": "New Schedule",
        "desc": "Configure automated daily or weekly delivery reports sent to your email.",
        "daily": "Daily (7:00 AM)",
        "weekly": "Weekly (Monday 7:00 AM)",
        "recipients_label": "Recipients (comma-separated emails)",
        "paused": "Paused",
        "pause": "Pause",
        "activate": "Activate",
        "send_now": "Send Now",
        "empty_title": "No scheduled reports",
        "empty_sub": "Create a schedule to receive automated daily or weekly delivery reports by email.",
        "freq": {"daily": "Daily", "weekly": "Weekly"},
        "col": {"recipients": "Recipients", "schedule": "Schedule"}
    }
})

# ── shipmentTracking additions ───────────────────────────────────────────────
data['shipmentTracking'].update({
    "subtitle": "Track, monitor and manage all shipments in real-time",
    "dispatch_map": "Dispatch Map",
    "tracking_loading": "Tracking...",
    "copy_link": "Copy Link",
    "live_track": "Live Track",
    "tracking_token": "Tracking Token",
    "edit_order": "Edit Order",
    "view_on_map": "View on Map",
    "search_placeholder": "Search by order #, name, phone, tracking...",
    "stats": {
        "total": "TOTAL SHIPMENTS",
        "in_transit": "IN TRANSIT",
        "delivered": "DELIVERED",
        "failed_returned": "FAILED / RETURNED",
        "today": "TODAY"
    },
    "tabs": {
        "all": "All Shipments",
        "active": "Active",
        "delivered": "Delivered",
        "failed": "Failed",
        "pending": "Pending"
    },
    "col": {"order_num": "Order #", "tracking": "Tracking"},
    "section": {
        "order_info": "Order Information",
        "progress": "Delivery Progress",
        "driver": "Assigned Driver",
        "timestamps": "Timestamps",
        "timeline": "Tracking Timeline",
        "pod": "Proof of Delivery",
        "items": "Order Items",
        "instructions": "Special Instructions"
    },
    "timestamp": {
        "picked_up": "Picked Up",
        "in_transit": "In Transit",
        "delivered": "Delivered",
        "failed": "Failed",
        "returned": "Returned"
    },
    "pod": {"signed_by": "Signed by"},
    "drawer": {"title": "Shipment Details"}
})

# ── cod additions ─────────────────────────────────────────────────────────────
data['cod'].update({
    "subtitle": "Track cash collections, driver settlements, and COD payments",
    "export_report": "Export Report",
    "search_placeholder": "Search orders or drivers...",
    "no_data": "No COD Data",
    "no_drivers": "No drivers with COD collections found",
    "no_phone": "No phone",
    "view_orders": "View Orders",
    "settle": "Settle",
    "no_orders": "No COD Orders",
    "no_orders_sub": "No cash-on-delivery orders match your filters",
    "settling": "Settling...",
    "confirm_settlement": "Confirm Settlement",
    "stats": {"total": "TOTAL COD", "collected": "COLLECTED", "pending": "PENDING", "orders": "COD ORDERS"},
    "tabs": {"overview": "Driver Overview", "orders": "COD Orders"},
    "driver": {"collected": "COLLECTED", "pending": "PENDING", "orders": "ORDERS", "delivered": "DELIVERED"},
    "col": {"amount": "COD Amount", "delivery_fee": "Delivery Fee"},
    "status": {"collected": "Collected"},
    "modal": {
        "title": "Settle COD",
        "total_collected": "Total Collected",
        "delivered_orders": "Delivered Orders",
        "amount_to_settle": "Amount to Settle",
        "confirm_text": "This will mark all collected COD amounts for this driver as settled."
    }
})

# ── returns additions ─────────────────────────────────────────────────────────
data['returns'].update({
    "submit": "Submit Return",
    "tabs": {"all": "All Returns", "pending": "Pending", "in_progress": "In Progress", "completed": "Completed", "rejected": "Rejected"},
    "col": {"reason": "Reason", "requested": "Requested"},
    "modal": {"new_title": "New Return Request", "detail_title": "Return Details"},
    "form": {"order": "Order *", "select_order": "Select delivered order", "reason": "Reason *", "select_reason": "Select reason"},
    "detail": {"reason": "Reason", "requested": "Requested", "resolved": "Resolved"}
})

# ── dispatch additions ────────────────────────────────────────────────────────
data['dispatch'].update({
    "title": "Dispatch Board",
    "subtitle": "Assign drivers to orders in real time",
    "live_map": "Live Map",
    "select_driver": "Select Driver...",
    "assigning": "Assigning...",
    "assign_driver": "Assign Driver",
    "no_active": "No active orders",
    "view": {"board": "Board", "map": "Map"},
    "col": {"unassigned": "Unassigned", "in_progress": "In Progress"},
    "map": {"no_locations": "No locations to display", "no_coords": "Orders and drivers need GPS coordinates to appear on the map"},
    "legend": {"unassigned": "Unassigned", "in_progress": "In Progress", "drivers": "Drivers"},
    "popup": {"zone": "Zone:", "delivery_address": "Delivery Address"}
})

# ── invoices additions ────────────────────────────────────────────────────────
data['invoices'].update({
    "subtitle": "Auto-generated from confirmed orders \u00b7 Real-time payment tracking",
    "label": "Invoice",
    "pdf": "PDF",
    "mark_paid": "Mark Paid",
    "mark_as_paid": "Mark as Paid",
    "download_pdf": "Download PDF",
    "due_date": "Due Date",
    "not_set": "Not set",
    "line_items": "Line Items",
    "subtotal": "Subtotal:",
    "tax": "Tax:",
    "paid_at": "Paid:",
    "walk_in": "Walk-in",
    "empty_hint": "Invoices are automatically generated when an order is confirmed. Try confirming an order or adjusting your filters.",
    "stats": {"total": "TOTAL INVOICED", "collected": "COLLECTED", "pending": "PENDING", "overdue": "OVERDUE"}
})

# ── performance additions ─────────────────────────────────────────────────────
data['performance'].update({
    "subtitle": "Delivery metrics, SLA compliance, and driver scorecards",
    "delivery_rate": "Delivery Rate",
    "avg_time": "Avg Delivery Time",
    "on_time": "On-Time",
    "failed_returned": "Failed / Returned",
    "export_title": "Export driver data",
    "no_orders_period": "No assigned orders found for the selected period",
    "tabs": {"sla": "SLA Overview", "scorecards": "Driver Scorecards"},
    "sla": {"first_attempt": "First-Attempt Success", "avg_speed": "Average Speed", "within": "Within SLA", "over": "Over SLA"},
    "chart": {"status_dist": "Status Distribution", "top_drivers": "Top Drivers", "top_drivers_sub": "By delivery success rate"},
    "col": {"avg_time": "Avg Time"}
})

# ── integrations additions ────────────────────────────────────────────────────
data['integrations'].update({
    "api_keys_sub": "Authenticate external systems \u2014 Shopify, WooCommerce, ERPs",
    "generate_key_btn": "Generate Key",
    "key_created_notice": "API Key Created \u2014 copy now, it will not be shown again",
    "paused": "Paused",
    "expires_never": "Never",
    "revoke": "Revoke",
    "enable": "Enable",
    "generating": "Generating\u2026",
    "webhooks_title": "Webhook Endpoints",
    "webhooks_sub": "Send real-time HTTP POST events to your apps on order status changes",
    "add_endpoint": "Add Endpoint",
    "no_webhooks_hint": "Add an endpoint to receive real-time delivery events",
    "add_first_endpoint": "Add First Endpoint",
    "last_fired": "Last fired: ",
    "test_ping": "Test Ping",
    "testing": "Testing\u2026",
    "pause": "Pause",
    "activate": "Activate",
    "delivery_log_title": "Webhook Delivery Log",
    "no_deliveries": "No deliveries yet",
    "no_deliveries_hint": "Webhook events appear here once triggered",
    "hmac_hint": "Requests signed with X-Pioneer-Signature HMAC-SHA256.",
    "create_webhook": "Create Webhook",
    "modal": {"edit_webhook": "Edit Webhook", "add_webhook": "Add Webhook Endpoint"},
    "form": {
        "key_name": "Key Name *",
        "key_name_placeholder": "e.g. WooCommerce",
        "permissions": "Permissions",
        "expires_at": "Expires At (optional)",
        "endpoint_name": "Endpoint Name *",
        "endpoint_url": "Endpoint URL *",
        "description": "Description (optional)"
    },
    "col": {
        "key_preview": "Key Preview",
        "permissions": "Permissions",
        "expires": "Expires",
        "event": "Event",
        "endpoint": "Endpoint",
        "http": "HTTP",
        "duration": "Duration",
        "attempt": "Attempt",
        "time": "Time"
    }
})

# ── clients additions ─────────────────────────────────────────────────────────
data['clients'].update({
    "search_location": "Search Location",
    "no_results": "No clients match your filters",
    "empty_title": "No clients yet",
    "empty_sub": "Add your first client to get started",
    "add_first": "+ Add First Client",
    "shown": "shown",
    "segment_label": "SEGMENT",
    "orders_done": "done",
    "step": {
        "basic_info": "Basic Info",
        "basic_info_desc": "Name & contact details",
        "business_info": "Business Info",
        "business_info_desc": "Type, category & emirate",
        "address_limit": "Address & Limit",
        "address_limit_desc": "Location, credit & notes"
    },
    "validation": {"full_name": "Full name is required", "phone": "Phone number is required"},
    "kpi": {
        "total": "Total Clients", "total_sub": "active",
        "orders": "Total Orders", "orders_sub": "all time",
        "corporate": "Corporate B2B", "corporate_sub": "business accounts",
        "ecommerce": "E-Commerce", "ecommerce_sub": "online stores"
    },
    "col": {"client": "Client", "contact": "Contact", "credit_limit": "Credit Limit"},
    "drawer": {
        "edit": "Edit Client", "new_order": "New Order",
        "deactivate": "Deactivate", "activate": "Activate",
        "profile": "Profile Information", "alt_phone": "Alt Phone", "joined": "Joined",
        "recent_orders": "Recent Orders",
        "stat": {"orders": "Total Orders", "delivered": "Delivered", "credit": "Credit Limit"}
    },
    "form": {
        "edit_title": "Edit Client", "new_title": "New Client",
        "full_name": "Full Name *", "full_name_placeholder": "e.g. Ahmed Al Mansouri",
        "phone": "Phone *", "phone_placeholder": "+971 50 123 4567",
        "email": "Email Address", "email_placeholder": "client@company.com",
        "select_zone": "\u2014 Select a zone (optional) \u2014",
        "latitude": "Latitude", "longitude": "Longitude",
        "use_zone_center": "Use Zone Center", "my_gps": "\U0001f4cd My GPS",
        "street_address": "Street Address",
        "street_placeholder": "Building, Street, Floor, Flat",
        "auto_zone": "Auto-populated from zone",
        "credit_limit": "Credit Limit (AED)", "no_limit_placeholder": "0 = No limit",
        "update_submit": "Update Client", "create_submit": "Create Client"
    },
    "confirm": {"title": "Deactivate Client?", "body": "will be marked as inactive. No data will be deleted.", "deactivate": "Deactivate"}
})

# ── notifications additions ───────────────────────────────────────────────────
data['notifications'].update({
    "sms_test": "SMS Test",
    "email_test": "Email Test",
    "send": "Send Notification",
    "no_sms": "No SMS logs found.",
    "no_email": "No email logs found.",
    "empty_hint": "Notifications will appear here when sent.",
    "sent_success": "Notification sent successfully!",
    "stats": {"total_sent": "Total Sent", "sms": "SMS", "email": "Email", "push": "Push", "failed": "Failed", "today": "Today"},
    "list": {"sms_logs": "SMS Logs", "email_logs": "Email Logs", "all": "All Notifications"},
    "col": {"message": "Message"},
    "form": {
        "channels": "Channels", "order_id": "Order ID (optional)", "user_id": "User ID (push target)",
        "message": "Message *", "characters": "characters", "sending_via": "Sending via:", "submit": "Send Notification"
    },
    "channel": {"email": "Email"},
    "modal": {"send_title": "Send Notification"},
    "sms_modal": {
        "title": "SMS Test", "sub": "Send a test SMS via Twilio", "sent": "Sent! SID:",
        "phone": "Phone (E.164) *", "message": "Message *", "order_id": "Order ID (optional)", "submit": "Send SMS"
    },
    "email_modal": {
        "title": "Email Test", "sub": "Send a test email via Office 365", "sent": "Email sent! ID:",
        "to": "To (email) *", "message": "Message *", "order_id": "Order ID (optional)", "submit": "Send Email"
    }
})

# ── zones additions ───────────────────────────────────────────────────────────
data['zones'].update({
    "page_title": "Delivery Zones",
    "add_btn": "Add Zone",
    "create_btn": "Create Zone",
    "edit_title": "Edit Zone",
    "create_title": "Create New Zone",
    "form_subtitle": "Define zone boundaries and pricing on the map",
    "map_hint": "Search a location above or click the map",
    "form": {"name": "Zone Name *", "emirate": "Emirate *", "base_fee": "Base Fee (AED)", "per_km": "Per km (AED)", "pricing": "Pricing"},
    "card": {"no_location": "No location \u2014 edit to set coordinates"},
    "no_location_hint": "No location set \u2014 click map or search above"
})

# ── orderDetail additions ─────────────────────────────────────────────────────
data['orderDetail'].update({
    "all_tracking": "All Tracking",
    "created": "Created:",
    "scheduled": "Scheduled:",
    "picked_up": "Picked up:",
    "delivered": "Delivered:",
    "no_items": "No items recorded for this order.",
    "update_status": "Update Status",
    "select_driver": "\u2014 Select driver \u2014",
    "area": "Area",
    "order_num": "Order #",
    "section": {"recipient": "Recipient", "order_info": "Order Info", "driver": "Driver", "location": "Location"}
})

# ── superAdmin (new section) ──────────────────────────────────────────────────
data['superAdmin'] = {
    "loading": "Loading dashboard...",
    "no_tenants": "No tenants found",
    "view_all": "View All",
    "col": {"company": "Company", "industry": "Industry", "users": "Users", "max_users": "Max Users", "tenant": "Tenant", "user": "User", "role": "Role"},
    "status": {"trial": "Trial", "suspended": "Suspended"},
    "stats": {"total_tenants": "Total Tenants", "active_tenants": "Active Tenants", "trial_tenants": "Trial Tenants", "total_users": "Total Users"},
    "dashboard": {
        "title": "Platform Dashboard",
        "subtitle": "Overview of Pioneer CRM platform",
        "platform_overview": "Platform Overview",
        "view_analytics": "View Analytics",
        "mrr": "Monthly Recurring Revenue",
        "active_subs": "Active Subscriptions",
        "suspended": "Suspended Accounts",
        "trial_conversions": "Trial Conversions",
        "recent_tenants": "Recent Tenants"
    },
    "tenants": {
        "title": "Tenant Management",
        "subtitle": "Manage all CRM client accounts",
        "new": "New Tenant",
        "search_placeholder": "Search tenants...",
        "set_max_users": "Set Max Users",
        "max_users_hint": "Set maximum number of users for this tenant",
        "max_users_label": "Max Users",
        "modules_hint": "Select which modules this tenant can access:",
        "save_modules": "Save Modules"
    },
    "modules": {
        "title": "Module Management",
        "subtitle": "Configure which modules each tenant can access",
        "available": "Available Modules",
        "tenant_access": "Tenant Module Access",
        "configure_for": "Configure Modules for",
        "col": {"enabled": "Enabled Modules"}
    },
    "users": {
        "title": "Platform Users",
        "subtitle": "Manage all users across tenants",
        "active": "Active Users",
        "tenants_count": "Tenants",
        "admins": "Admins",
        "search_placeholder": "Search users...",
        "all_tenants": "All Tenants",
        "no_users": "No users found",
        "last_login": "Last Login",
        "never_login": "Never"
    },
    "login": {
        "brand": "Pioneer Solutions",
        "brand_sub": "Delivery Platform Administration",
        "title": "Super Admin Access",
        "subtitle": "Restricted to platform administrators only",
        "username": "USERNAME",
        "username_placeholder": "Enter admin username",
        "password": "PASSWORD",
        "password_placeholder": "Enter admin password",
        "authenticating": "Authenticating...",
        "submit": "Access Admin Panel",
        "back_to": "Back to",
        "delivery_link": "Delivery Login \u2192",
        "connection_error": "Connection error. Please try again."
    }
}

with open('en.json', 'w') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
print('en.json done. Top-level keys:', list(data.keys()))
