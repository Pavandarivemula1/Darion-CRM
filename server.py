import http.server
import socketserver
import json
import csv
import io
import os

PORT = 8040
DATA_FILE = 'data.csv'

class CRMHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        if self.path == '/api/leads':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            try:
                if not os.path.exists(DATA_FILE):
                    self.wfile.write(b'[]')
                    return
                with open(DATA_FILE, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    data = list(reader)
                self.wfile.write(json.dumps(data).encode('utf-8'))
            except Exception as e:
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/update':
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            updated_lead = json.loads(post_data)

            try:
                with open(DATA_FILE, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    fieldnames = reader.fieldnames
                    leads = list(reader)

                for i, lead in enumerate(leads):
                    if lead['Lead ID'] == updated_lead['Lead ID']:
                        # Overwrite all fields present in the update
                        for k, v in updated_lead.items():
                            if k in lead:
                                leads[i][k] = v
                        break

                with open(DATA_FILE, 'w', encoding='utf-8', newline='') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()
                    writer.writerows(leads)

                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success'}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

        elif self.path == '/api/delete':
            try:
                content_length = int(self.headers['Content-Length'])
                post_data = self.rfile.read(content_length)
                payload = json.loads(post_data)
                ids_to_delete = payload.get('ids', [])
                
                with open(DATA_FILE, 'r', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    fieldnames = reader.fieldnames
                    leads = list(reader)
                
                leads = [lead for lead in leads if lead['Lead ID'] not in ids_to_delete]
                
                with open(DATA_FILE, 'w', encoding='utf-8', newline='') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()
                    writer.writerows(leads)
                    
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', 'deleted': len(ids_to_delete)}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

        elif self.path == '/api/upload':
            try:
                content_length = int(self.headers['Content-Length'])
                raw_csv_data = self.rfile.read(content_length).decode('utf-8')
                
                f_in = io.StringIO(raw_csv_data)
                reader = csv.DictReader(f_in)
                
                with open(DATA_FILE, 'r', encoding='utf-8') as f:
                    existing_reader = csv.DictReader(f)
                    fieldnames = existing_reader.fieldnames
                    existing_leads = list(existing_reader)
                
                last_id = 1000
                if existing_leads:
                    last_id_str = existing_leads[-1].get('Lead ID', 'L-1000')
                    try:
                        last_id = int(last_id_str.split('-')[1])
                    except:
                        pass
                    
                new_leads = []
                for row in reader:
                    last_id += 1
                    lead_id = f"L-{last_id}"
                    
                    name = row.get('business_name', row.get('Name', ''))
                    phone = row.get('phone_number', row.get('Phone', ''))
                    email = row.get('email', row.get('Email', ''))
                    location = row.get('address', row.get('Location', ''))
                    category = row.get('category', row.get('Category', ''))
                    
                    new_leads.append({
                        'Lead ID': lead_id,
                        'Name': name.strip(),
                        'Phone': phone.strip(),
                        'Email': email.strip(),
                        'Source': 'Uploaded CSV',
                        'Location': location.strip(),
                        'Lead Status': 'New',
                        'Combined Score': '',
                        'Category (Pitch Angle)': category.strip(),
                        'Website': row.get('website', ''),
                        'Has WhatsApp': row.get('has_whatsapp', ''),
                        'Is Website Poor': row.get('is_website_poor', ''),
                        'Budget': '',
                        'Requirement Type': '',
                        'Urgency Level': '',
                        'Last Contacted Date': '',
                        'Next Follow-Up Date': '',
                        'Follow-Up Count': '0',
                        'Follow-Up Notes': '',
                        'Preferred Contact': 'Phone' if phone else 'Email',
                        'Stage': 'New',
                        'Assigned Salesperson': '',
                        'Expected Value': '',
                        'Probability (%)': '',
                        'Days Since Contact': '',
                        'Follow-Up Priority (Auto)': 'Medium',
                        'Reminder Flag (Auto)': 'Scheduled'
                    })
                    
                existing_leads.extend(new_leads)
                
                with open(DATA_FILE, 'w', encoding='utf-8', newline='') as f:
                    writer = csv.DictWriter(f, fieldnames=fieldnames)
                    writer.writeheader()
                    writer.writerows(existing_leads)
                    
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'status': 'success', 'added': len(new_leads)}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.end_headers()
                self.wfile.write(json.dumps({'error': str(e)}).encode('utf-8'))

if __name__ == "__main__":
    import socket
    def get_local_ip():
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # connect() for UDP doesn't send packets, just sets default route
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            s.close()
            return ip
        except Exception:
            return "127.0.0.1"

    local_ip = get_local_ip()
    
    # "0.0.0.0" ensures the server listens on all network interfaces
    with socketserver.TCPServer(("0.0.0.0", PORT), CRMHandler) as httpd:
        print(f"CRM API Server strictly operational at port {PORT}")
        print("-" * 50)
        print(f"🏡 Local Access:   http://localhost:{PORT}")
        print(f"🌍 Network Access: http://{local_ip}:{PORT}")
        print("-" * 50)
        print("To view this on other devices, make sure they are connected to ")
        print(f"the same Wi-Fi network and open the 'Network Access' URL above.\n")
        httpd.serve_forever()
