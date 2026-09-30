# Laya isn't in nixpkgs. The PyPI wheel is pure Python; torch and friends come from nixpkgs.
{
  lib,
  buildPythonPackage,
  fetchPypi,
  huggingface-hub,
  numpy,
  safetensors,
  torch,
  transformers,
}:

buildPythonPackage rec {
  pname = "laya";
  version = "0.3.22";
  format = "wheel";

  src = fetchPypi {
    inherit pname version format;
    dist = "py3";
    python = "py3";
    hash = "sha256-QI5xa5RqBWap1AkBF9TflkdUC2Q14vPf7Qssaxq+7Yo=";
  };

  dependencies = [
    huggingface-hub
    numpy
    safetensors
    torch
    transformers
  ];

  pythonImportsCheck = [ "laya" ];

  meta = {
    description = "Non-autoregressive System 1 decision model";
    homepage = "https://github.com/NandhaKishorM/laya";
    license = lib.licenses.asl20;
  };
}
