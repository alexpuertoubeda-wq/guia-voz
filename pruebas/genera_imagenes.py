#!/usr/bin/env python3
"""Genera las imágenes de prueba del lector de textos de Paso Firme.

Uso: python3 genera_imagenes.py CARPETA_DE_SALIDA

Escribe en la carpeta:
  - varias imágenes PNG (página tipo periódico, dos columnas, cartel y
    versiones degradadas: oscura, movida, girada, cortada, en blanco, "foto");
  - por cada imagen, un archivo .gris con los píxeles en gris (1 byte por píxel)
    para probar en Node las funciones de calidad de imagen;
  - casos.json con el tamaño de cada imagen y el texto verdadero.

Solo necesita Pillow y NumPy. Las tipografías son las del sistema (FreeSerif,
parecida a la Times de los periódicos, y DejaVu).
"""
import json
import os
import random
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SERIF = '/usr/share/fonts/truetype/freefont/FreeSerif.ttf'
SERIF_NEGRITA = '/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf'
PALO = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

TITULAR = 'El Ayuntamiento amplía el horario de los autobuses nocturnos'
PARRAFOS = [
    'La concejalía de Movilidad anunció ayer que, a partir del próximo mes de '
    'septiembre, los autobuses nocturnos circularán también de domingo a jueves. '
    'La medida responde a una petición de las asociaciones vecinales, que llevaban '
    'más de dos años reclamándola.',
    'Según explicó el señor Ibáñez, portavoz del área, el servicio costará unos '
    '340.000 euros al año y dará trabajo a catorce conductores. «No es un lujo: es '
    'una necesidad para quienes salen de trabajar de madrugada», afirmó.',
    '¿Qué cambiará para los vecinos? Las líneas uno y cuatro pasarán cada veinte '
    'minutos y llegarán hasta el hospital. Además, los niños menores de ocho años '
    'viajarán gratis, igual que las personas mayores con la tarjeta dorada.',
]
PARRAFOS_COLUMNAS = [
    'La cigüeña blanca ha vuelto a anidar en el campanario de la iglesia mayor. '
    'Los vecinos contaron este año nueve parejas, tres más que el pasado otoño.',
    'El biólogo Íñigo Muñoz explica que el pequeño humedal del río ofrece '
    'alimento de sobra: ranas, peces y algún que otro ratón de campo.',
    'El próximo sábado habrá una excursión guiada para las familias. La salida '
    'será a las diez de la mañana desde la plaza de España y no hace falta pagar.',
    'Quien desee apuntarse puede llamar al teléfono de la oficina de turismo o '
    'escribir un correo. El número de plazas está limitado a cuarenta personas.',
]
CARTEL = ['FARMACIA', 'Abierto de 9 a 14 horas', 'Sábados cerrado']

VOCALES = 'aeiouáéíóúü'


def partir_palabra(palabra, cabe):
    """Busca un corte silábico sencillo (vocal + consonante + vocal) cuyo primer
    trozo, con guion, quepa en la línea. Devuelve (inicio, resto) o None."""
    letras = palabra.rstrip('.,;:!?»')
    if len(letras) < 7 or not letras.isalpha():
        return None
    for i in range(len(letras) - 3, 2, -1):
        a, b, c = letras[i - 1].lower(), letras[i].lower(), letras[i + 1].lower()
        if a in VOCALES and b not in VOCALES and c in VOCALES and b not in 'rlh':
            if cabe(palabra[:i] + '-'):
                return palabra[:i] + '-', palabra[i:]
    return None


def componer(texto, fuente, ancho, con_guiones=True):
    """Ajusta el texto al ancho. Devuelve la lista de líneas."""
    dibujo = ImageDraw.Draw(Image.new('L', (10, 10)))

    def cabe(s):
        return dibujo.textlength(s, font=fuente) <= ancho

    lineas, actual = [], ''
    palabras = texto.split(' ')
    i = 0
    while i < len(palabras):
        p = palabras[i]
        prueba = (actual + ' ' + p) if actual else p
        if cabe(prueba):
            actual = prueba
            i += 1
            continue
        if con_guiones and actual:
            corte = partir_palabra(p, lambda s: cabe(actual + ' ' + s))
            if corte:
                lineas.append(actual + ' ' + corte[0])
                actual = ''
                palabras[i] = corte[1]
                continue
        lineas.append(actual)
        actual = ''
    if actual:
        lineas.append(actual)
    return lineas


def pintar_bloque(dibujo, x, y, parrafos, fuente, ancho, interlinea, separacion):
    for parrafo in parrafos:
        for linea in componer(parrafo, fuente, ancho):
            dibujo.text((x, y), linea, font=fuente, fill=20)
            y += interlinea
        y += separacion
    return y


def pagina_periodico(cuerpo=30):
    ancho, alto = 1400, 1000
    img = Image.new('L', (ancho, alto), 244)
    d = ImageDraw.Draw(img)
    margen = 90
    f_titular = ImageFont.truetype(SERIF_NEGRITA, int(cuerpo * 1.7))
    f_texto = ImageFont.truetype(SERIF, cuerpo)
    y = 70
    for linea in componer(TITULAR, f_titular, ancho - 2 * margen, con_guiones=False):
        d.text((margen, y), linea, font=f_titular, fill=15)
        y += int(cuerpo * 2.1)
    y += 25
    pintar_bloque(d, margen, y, PARRAFOS, f_texto, ancho - 2 * margen,
                  int(cuerpo * 1.32), int(cuerpo * 0.9))
    return img


def pagina_columnas(cuerpo=28):
    ancho, alto = 1500, 900
    img = Image.new('L', (ancho, alto), 244)
    d = ImageDraw.Draw(img)
    margen, calle = 80, 70
    ancho_col = (ancho - 2 * margen - calle) // 2
    f = ImageFont.truetype(SERIF, cuerpo)
    inter, sep = int(cuerpo * 1.32), int(cuerpo * 0.9)
    pintar_bloque(d, margen, 80, PARRAFOS_COLUMNAS[:2], f, ancho_col, inter, sep)
    pintar_bloque(d, margen + ancho_col + calle, 80, PARRAFOS_COLUMNAS[2:], f, ancho_col, inter, sep)
    return img


def cartel():
    img = Image.new('L', (1200, 800), 235)
    d = ImageDraw.Draw(img)
    d.rectangle((60, 60, 1140, 740), outline=30, width=10)
    d.text((600, 250), CARTEL[0], font=ImageFont.truetype(PALO, 150), fill=20, anchor='mm')
    d.text((600, 470), CARTEL[1], font=ImageFont.truetype(PALO, 64), fill=20, anchor='mm')
    d.text((600, 600), CARTEL[2], font=ImageFont.truetype(PALO, 64), fill=20, anchor='mm')
    return img


def oscurecer(img, factor=0.13):
    a = np.asarray(img, dtype=np.float32) * factor
    rng = np.random.default_rng(7)
    a = a + rng.normal(0, 5, a.shape)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def mover(img, largo=23, eje=1):
    """Desenfoque de movimiento (el móvil se ha movido al disparar).
    eje=1 horizontal, eje=0 vertical."""
    centro = largo // 2
    a = np.asarray(img, dtype=np.float32)
    acum = np.zeros_like(a)
    for d in range(-centro, centro + 1):
        acum += np.roll(a, d, axis=eje)
    return Image.fromarray(np.clip(acum / (2 * centro + 1), 0, 255).astype(np.uint8))


def ruido(img, sigma):
    a = np.asarray(img, dtype=np.float32)
    a = a + np.random.default_rng(5).normal(0, sigma, a.shape)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def foto(img):
    """Simula una foto de móvil: ligera inclinación, luz desigual, algo de
    desenfoque, ruido y compresión JPEG."""
    random.seed(11)
    g = img.rotate(1.6, resample=Image.BICUBIC, expand=False, fillcolor=244)
    a = np.asarray(g, dtype=np.float32)
    alto, ancho = a.shape
    xs = np.linspace(0, 1, ancho)[None, :]
    ys = np.linspace(0, 1, alto)[:, None]
    luz = 0.62 + 0.38 * (0.6 * xs + 0.4 * ys)          # esquina más oscura
    a = a * luz
    g = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.9))
    a = np.asarray(g, dtype=np.float32)
    a += np.random.default_rng(3).normal(0, 6, a.shape)
    g = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    return g


def guardar(carpeta, nombre, img, casos, texto, formato='png', **extra):
    ruta = os.path.join(carpeta, nombre + '.' + formato)
    if formato == 'jpg':
        img.save(ruta, quality=70)
        img = Image.open(ruta).convert('L')
    else:
        img.save(ruta)
    # Copia en gris reducida a 1000 px de lado mayor, que es la escala a la que
    # lectura.js mide la calidad de imagen en el navegador.
    g = img.convert('L')
    mayor = max(g.size)
    if mayor > 1000:
        g = g.resize((round(g.width * 1000 / mayor), round(g.height * 1000 / mayor)), Image.BILINEAR)
    np.asarray(g, dtype=np.uint8).tofile(os.path.join(carpeta, nombre + '.gris'))
    caso = {'archivo': nombre + '.' + formato, 'gris': nombre + '.gris',
            'ancho': img.width, 'alto': img.height,
            'gris_ancho': g.width, 'gris_alto': g.height, 'texto': texto}
    caso.update(extra)
    casos[nombre] = caso


def main():
    carpeta = sys.argv[1]
    os.makedirs(carpeta, exist_ok=True)
    casos = {}
    texto_periodico = TITULAR + '\n\n' + '\n\n'.join(PARRAFOS)
    texto_columnas = '\n\n'.join(PARRAFOS_COLUMNAS)

    periodico = pagina_periodico()
    columnas = pagina_columnas()
    guardar(carpeta, 'periodico', periodico, casos, texto_periodico)
    guardar(carpeta, 'columnas', columnas, casos, texto_columnas)
    guardar(carpeta, 'cartel', cartel(), casos, '\n\n'.join(CARTEL))
    guardar(carpeta, 'foto', foto(periodico), casos, texto_periodico, formato='jpg')
    guardar(carpeta, 'oscura', oscurecer(periodico), casos, texto_periodico)
    guardar(carpeta, 'negra', oscurecer(periodico, 0.04), casos, texto_periodico)
    guardar(carpeta, 'movida', mover(periodico), casos, texto_periodico)
    guardar(carpeta, 'movida_vertical', mover(periodico, 15, eje=0), casos, texto_periodico)
    guardar(carpeta, 'movida_ruido', ruido(mover(periodico, 15), 8), casos, texto_periodico)
    guardar(carpeta, 'desenfocada', ruido(periodico.filter(ImageFilter.GaussianBlur(3.5)), 4), casos, texto_periodico)
    # Quemada: tanta luz que el texto casi desaparece sobre el blanco.
    q = 255 - (255 - np.asarray(periodico, dtype=np.float32)) * 0.012
    guardar(carpeta, 'quemada', Image.fromarray(np.clip(q, 0, 255).astype(np.uint8)), casos, texto_periodico)
    lejos = Image.new('L', (1400, 1000), 244)
    lejos.paste(periodico.resize((420, 300), Image.LANCZOS), (490, 350))
    guardar(carpeta, 'lejana', lejos, casos, texto_periodico)
    guardar(carpeta, 'girada180', periodico.rotate(180), casos, texto_periodico)
    guardar(carpeta, 'girada90', periodico.rotate(90, expand=True), casos, texto_periodico)
    # Cortada: se pierde el margen y el principio de cada línea por la izquierda.
    guardar(carpeta, 'cortada', periodico.crop((150, 0, 1400, 1000)), casos, texto_periodico)
    guardar(carpeta, 'blanca', Image.new('L', (1200, 900), 228), casos, '')
    # Texto pequeño, como una página entera vista desde lejos (mitad de tamaño).
    guardar(carpeta, 'pequena', periodico.resize((700, 500), Image.LANCZOS), casos, texto_periodico)

    with open(os.path.join(carpeta, 'casos.json'), 'w', encoding='utf-8') as f:
        json.dump(casos, f, ensure_ascii=False, indent=1)
    print('Imágenes generadas en', carpeta, ':', ', '.join(sorted(casos)))


if __name__ == '__main__':
    main()
