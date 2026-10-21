"""Comando mantido para executar a validação do editor atual, organizado por tabelas."""
import runpy
from pathlib import Path


def main():
    runpy.run_path(str(Path(__file__).with_name('base-fatores-tabelas.py')))['main']()


if __name__ == '__main__':
    main()
