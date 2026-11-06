import zlib
import struct
import os

def create_png(width, height, color_bg, draw_bars=True):
    # RGBA format
    raw_data = bytearray()
    
    r_bg, g_bg, b_bg = color_bg
    r_amber, g_amber, b_amber = (245, 158, 11)
    r_cyan, g_cyan, b_cyan = (6, 182, 212)
    
    for y in range(height):
        raw_data.append(0) # filter type none
        for x in range(width):
            # check if pixel is part of bars
            nx = x / width
            ny = y / height
            
            # Simple border
            if x < 4 or x >= width - 4 or y < 4 or y >= height - 4:
                raw_data.extend([38, 46, 56, 255])
                continue
                
            # DAW waveform bar motif
            is_bar = False
            bar_color = None
            if draw_bars and 0.25 <= ny <= 0.75:
                # 8 bars across 0.2 to 0.8 nx
                for i in range(8):
                    bx_start = 0.22 + i * 0.075
                    bx_end = bx_start + 0.045
                    if bx_start <= nx <= bx_end:
                        # heights of bars
                        h_factors = [0.4, 0.6, 0.85, 0.55, 0.95, 0.65, 0.75, 0.5]
                        bar_h = h_factors[i]
                        bar_top = 0.75 - bar_h * 0.45
                        if bar_top <= ny <= 0.75:
                            is_bar = True
                            bar_color = (r_amber, g_amber, b_amber) if i < 4 else (r_cyan, g_cyan, b_cyan)
                            break
            
            if is_bar and bar_color:
                raw_data.extend([bar_color[0], bar_color[1], bar_color[2], 255])
            else:
                raw_data.extend([r_bg, g_bg, b_bg, 255])
                
    def chunk(chunk_type, data):
        c = chunk_type + data
        crc = zlib.crc32(c) & 0xffffffff
        return struct.pack('>I', len(data)) + c + struct.pack('>I', crc)
        
    png = bytearray(b'\x89PNG\r\n\x1a\n')
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    png.extend(chunk(b'IHDR', ihdr))
    compressed = zlib.compress(bytes(raw_data), 9)
    png.extend(chunk(b'IDAT', compressed))
    png.extend(chunk(b'IEND', b''))
    return bytes(png)

os.makedirs('public', exist_ok=True)

with open('public/pwa-192x192.png', 'wb') as f:
    f.write(create_png(192, 192, (18, 22, 27)))

with open('public/pwa-512x512.png', 'wb') as f:
    f.write(create_png(512, 512, (18, 22, 27)))

with open('public/apple-touch-icon.png', 'wb') as f:
    f.write(create_png(180, 180, (18, 22, 27)))

with open('public/pwa-maskable-512x512.png', 'wb') as f:
    f.write(create_png(512, 512, (11, 13, 16)))

print("PWA PNG icons generated successfully.")
